'use strict'

/*
 * adonis-lucid
 *
 * (c) Harminder Virk <virk@adonisjs.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
*/

const _ = require('lodash')
const RelationsParser = require('../Relations/Parser')

class EagerLoad {
  constructor (relations) {
    this._relations = RelationsParser.parseRelations(relations)
  }

  /**
   * Calls the eagerloading callback on the related instance
   * query only when defined
   *
   * @method _applyRuntimeConstraints
   *
   * @param  {Object}     options.query
   * @param  {Function}   callback
   *
   * @return {void}
   *
   * @private
   */
  _applyRuntimeConstraints ({ query }, callback) {
    if (typeof (callback) === 'function') {
      callback(query)
    }
  }

  /**
   * Fetches nested relationships when they are defined
   *
   * @method _fetchNested
   *
   * @param  {Object}     options.query
   * @param  {Object}     nested
   *
   * @return {void}
   *
   * @private
   */
  _fetchNested ({ query }, nested) {
    if (nested) {
      const name = _.first(_.keys(nested))
      query.with(name, nested[name])
    }
  }

  /**
   * Calls the whereIn query for eagerloading relationship for
   * multiple parent records. Also it will use the relationship
   * instance to map the right values and then return grouped
   * result.
   *
   * @method _eagerLoad
   *
   * @param  {Array}   rows
   * @param  {Object}   relationInstance
   *
   * @return {Array}
   *
   * @private
   */
  async _eagerLoad (rows, relationInstance) {
    const relatedInstances = await relationInstance
      .query
      .whereIn(relationInstance.foreignKey, relationInstance.mapValues(rows))
      .fetch()

    /**
     * We need to pull `rows` since the return value from fetch is a collection.
     */
    return relationInstance.group(relatedInstances.rows)
  }

  /**
   * Loads a single relationship of the model. This method
   * will execute parallel queries for multiple relations.
   *
   * The return value is a key/value pair of relations and
   * their resolved values.
   *
   * @method loadOne
   *
   * @return {Object}
   */
  async loadOne (modelInstance) {
    const relationsKeys = _.keys(this._relations)

    /**
     * Gets an array of queries to be executed in parallel
     */
    const queries = _.map(this._relations, (attributes, relation) => {
      RelationsParser.validateRelationExistence(modelInstance, relation)
      const relationInstance = RelationsParser.getRelatedInstance(modelInstance, relation)
      this._applyRuntimeConstraints(relationInstance, attributes.callback)
      this._fetchNested(relationInstance, attributes.nested)
      return relationInstance.load()
    })

    const relatedModels = await Promise.all(queries)

    /**
     * Since Promise.all returns values in an order, we can map
     * each relation value back to it's key.
     *
     * For example: If we are loading `profiles` and `settings` for a
     * given user, we will get back result back in same order and
     * then we can transform the result and return an object
     * with key/value pairs.
     */
    return _.transform(relationsKeys, (result, key, index) => {
      result[key] = relatedModels[index]
      return result
    }, {})
  }

  async load (modelInstances) {
    const relationsKeys = _.keys(this._relations)

    /**
     * Since all rows will become to the same user, we just need
     * any one instance for reading some properties of the
     * instance.
     */
    const modelInstance = modelInstances[0]

    const queries = _.map(this._relations, (attributes, relation) => {
      RelationsParser.validateRelationExistence(modelInstance, relation)
      const relationInstance = RelationsParser.getRelatedInstance(modelInstance, relation)
      this._applyRuntimeConstraints(relationInstance, attributes.callback)
      this._fetchNested(relationInstance, attributes.nested)
      return this._eagerLoad(modelInstances, relationInstance)
    })

    const relatedModelsGroup = await Promise.all(queries)

    /**
     * Here we have an array of different relations for multiple parent
     * records. What we need is to fetch the parent level record and
     * set relationships for each relation on it. Same is done
     * for all parent records.
     */
    _.each(relationsKeys, (key, index) => {
      const relationGroups = relatedModelsGroup[index]
      /**
       * We should loop over actual data set and not the resolved relations.
       * There are chances when actual relation set will have more rows
       * than relations, in that case we need to set relations to
       * `null` or whatever the default value is.
       */
      _.each(modelInstances, (modelInstance) => {
        /**
         * Find the actual value of the relationship for that model instances
         */
        const value = relationGroups.values.find((group) => {
          return group.identity === modelInstance[relationGroups.key]
        }) || { value: relationGroups.defaultValue }

        /**
         * Setting relationship on the parent model instance
         */
        modelInstance.setRelated(key, value.value)
      })
    })
  }
}

module.exports = EagerLoad