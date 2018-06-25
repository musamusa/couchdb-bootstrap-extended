'use strict'

import fs from 'fs.extra'
import url from 'url'
import path from 'path'
import util from 'util'
import bootstrap from 'couchdb-bootstrap'
import Promise from 'bluebird'
import request from 'request-promise'
import ensure from 'couchdb-ensure'
import Utility from 'node-code-utility'

let instance
let bootstrapInstance
let filesToDelete = []

class CouchDBBootstrapInternal {
  constructor (couchdbFolderPath, couchdbUrl) {
    this.couchAppDir = path.join(couchdbFolderPath, 'app')
    this.couchWorkingDir = path.join(couchdbFolderPath, '_app_')
    this.userDir = path.join(this.couchWorkingDir, '_users')
    this.dbUrl = couchdbUrl
  }

  getBaseUrl () {
    const urlParts = url.parse(this.dbUrl)
    delete urlParts.path
    delete urlParts.pathname
    return url.format(urlParts)
  }

  ensureDB (db) {
    return new Promise((resolve, reject) => {
      ensure(db, (error, response) => {
        if (error) {
          return reject(error)
        }
        return resolve(response)
      })
    })
  }

  compileConfig (allSettings, filePath, node) {
    if (!fs.existsSync(filePath)) {
      return allSettings
    }
    const config = require(filePath)
    const settings = this.formatConfigData(config, node)
    return allSettings.concat(settings)
  }

  getConfigByNode (response) {
    let allSettings = []
    if (response.cluster_nodes && response.cluster_nodes.length > 0) {
      let i = response.cluster_nodes.length
      while (i--) {
        const node = response.cluster_nodes[i]
        const filePath = path.join(this.couchWorkingDir, '_node', node, '_config.json')
        const fallbackPath = path.join(this.couchWorkingDir, '_node', '_config.json')
        if (fs.existsSync(filePath)) {
          allSettings = this.compileConfig(allSettings, filePath, node)
        } else {
          allSettings = this.compileConfig(allSettings, fallbackPath, node)
        }
      }
    }
    return allSettings
  }

  getConfigWithoutNode () {
    let settings = []
    const filePath = path.join(this.couchWorkingDir, '_node', '_config.json')
    if (fs.existsSync(filePath)) {
      const config = require(filePath)
      settings = this.formatConfigData(config)
    }
    return settings
  }

  formatConfigData (config, node) {
    return Object.keys(config)
      .reduce((memo, key) => {
        if (typeof config[key] !== 'object') return memo

        const section = Object.keys(config[key])
          .map((k) => {
            const nodePath = node ? `_node/${node}/` : ''
            return {
              path: `${nodePath}_config/${encodeURIComponent(key)}/${encodeURIComponent(k)}`,
              value: config[key][k].toString()
            }
          })

        return memo.concat(section)
      }, [])
  }

  pushToCouch (settings) {
    const responseMapping = {}
    return Promise.mapSeries(settings, (setting) => {
      const params = {
        url: `${this.getBaseUrl()}${setting.path}`,
        body: setting.value,
        json: true
      }
      return request.put(params)
        .then(response => {
          responseMapping[setting.path] = response
          return response
        })
    })
      .then(() => responseMapping)
  }

  mapDBName (baseName) {
    const baseDir = path.join(this.couchWorkingDir, baseName, '/_design/')
    if (fs.existsSync(baseDir)) {
      let dirList = fs.readdirSync(baseDir)
      let i = dirList.length
      while (i--) {
        const topSubDir = path.join(baseDir, dirList[i], 'views')
        if (fs.existsSync(topSubDir)) {
          const subDirList = fs.readdirSync(topSubDir)
          let j = subDirList.length
          while (j--) {
            const mapCodeFilePath = path.join(topSubDir, subDirList[j], 'map-code.js')
            const reduceCodeFilePath = path.join(topSubDir, subDirList[j], 'reduce-code.js')
            const mapFile = path.join(topSubDir, subDirList[j], 'map.js')
            if (fs.existsSync(mapCodeFilePath) && filesToDelete.indexOf(mapFile) === -1) {
              let mapContent = require(mapCodeFilePath).map.toString()
              // filesToDelete.push(mapFile)
              fs.writeFileSync(mapFile, mapContent)
              fs.unlinkSync(mapCodeFilePath)
            }

            if (fs.existsSync(reduceCodeFilePath)) {
              const reduceFile = path.join(topSubDir, subDirList[j], 'reduce.js')
              let reduceContent = require(reduceCodeFilePath).reduce.toString()
              fs.writeFileSync(reduceFile, reduceContent)
              fs.unlinkSync(reduceCodeFilePath)
            }
          }
        }
      }
    }
    return baseName
  }

  cleanCodeFiles () {
    const dirList = fs.readdirSync(this.couchWorkingDir)
    let length = dirList.length
    while (length--) {
      const dir = dirList[length]
      this.mapDBName(dir)
    }
  }

  bootstrapCallback (resolve, reject, err, res) {
    let length = filesToDelete.length
    while (length--) {
      try {
        fs.unlinkSync(filesToDelete[length])
      } catch (e) {}
    }
    filesToDelete = []
    this.deleteFolderRecursive(path.join(this.couchWorkingDir, '_users'))
    if (err) {
      reject(err)
    }
    // Untruncate
    res = util.inspect(res, {
      depth: null
    })
    resolve(res)
  }

  setUpUsers () {
    const userDocDir = path.join(this.couchWorkingDir, '_users_doc')
    try {
      fs.mkdirRecursiveSync(this.userDir)
    } catch (e) { console.log('file create error', e) }
    if (fs.existsSync(userDocDir)) {
      let userFileList = fs.readdirSync(userDocDir)
      let ui = userFileList.length
      while (ui--) {
        const userFilePath = path.join(userDocDir, userFileList[ui])
        const userJSONPath = path.join(this.userDir, userFileList[ui].replace('.json', '').replace('.js', '.json'))
        if (filesToDelete.indexOf(userJSONPath) === -1) {
          const userContent = JSON.stringify(require(userFilePath).user)
          fs.writeFileSync(userJSONPath, userContent)
        }
      }
      fs.rmrfSync(userDocDir)
    }
  }

  deleteFolderRecursive (path) {
    if (fs.existsSync(path)) {
      fs.readdirSync(path).forEach((file) => {
        const curPath = path + '/' + file
        if (fs.lstatSync(curPath).isDirectory()) {
          this.deleteFolderRecursive(curPath)
        } else {
          fs.unlinkSync(curPath)
        }
      })
      fs.rmdirSync(path)
    }
  }

  createWorkingDir () {
    return new Promise((resolve, reject) => {
      fs.copyRecursive(this.couchAppDir, this.couchWorkingDir, (error) => {
        if (error) {
          return reject(error)
        }
        return resolve({message: 'copied'})
      })
    })
  }

  removeWorkingDir () {
    return new Promise((resolve, reject) => {
      fs.rmrf(this.couchWorkingDir, (error) => {
        if (error) {
          return reject(error)
        }
        return resolve({message: 'removed'})
      })
    })
  }

  static getInstance (couchdbFolderPath, couchdbUrl) {
    instance = instance || new CouchDBBootstrapInternal(couchdbFolderPath, couchdbUrl)
    return instance
  }
}

class CouchDBBootstrap {
  constructor (couchDBOptions) {
    this.options = Utility.is.object(couchDBOptions) ? couchDBOptions : {}
    this.options.db = this.options.db || 'localDB'
    this.options.dbOptions = Utility.is.object(this.options.dbOptions) ? this.options.dbOptions : {}

    this.couchdbUrl = this.getDBFUllUrl()
    this.couchdbFolderPath = this.options.couchdbFolderPath
  }

  getDBBaseUrl () {
    const urlObject = new url.URL(this.options.host)
    if (this.options.auth && Utility.is.object(this.options.auth) && this.options.auth.username && this.options.auth.password) {
      urlObject.auth = `${this.options.auth.username}:${this.options.auth.password}`
    }
    urlObject.path = ''
    urlObject.pathname = ''
    urlObject.port = this.options.port || 80
    return url.format(urlObject)
  }

  getDBFUllUrl () {
    const urlObject = new url.URL(this.getDBBaseUrl())
    urlObject.path = `/${this.options.db}`
    urlObject.pathname = urlObject.path
    return url.format(urlObject)
  }

  ensureDBSetup () {
    const internalInstance = CouchDBBootstrapInternal.getInstance(this.couchdbFolderPath, this.couchdbUrl)
    const userDB = [internalInstance.getBaseUrl(), '_users'].join('')
    const replicator = [internalInstance.getBaseUrl(), '_replicator'].join('')
    const globalChanges = [internalInstance.getBaseUrl(), '_global_changes'].join('')
    const metadata = [internalInstance.getBaseUrl(), '_metadata'].join('')
    const dbUrl = this.couchdbUrl
    const dbList = [userDB, replicator, globalChanges, metadata, dbUrl]

    return Promise.mapSeries(dbList, (db) => {
      if (db.indexOf('_global_changes')) {
        return internalInstance.ensureDB(db)
          .catch(Promise.resolve)
      }
      return internalInstance.ensureDB(db)
    })
  }

  bootstrap () {
    const options = {mapDbName: {}}
    const isObject = Object.prototype.toString.call(this.options.dbOptions) === '[object Object]'
    const internalInstance = CouchDBBootstrapInternal.getInstance(this.couchdbFolderPath, this.couchdbUrl)

    if (isObject && this.options.dbOptions.src && this.options.dbOptions.target) {
      options.mapDbName[this.options.dbOptions.src] = this.options.dbOptions.target
    }

    return new Promise((resolve, reject) => {
      bootstrap(
        {
          url: internalInstance.getBaseUrl()
        },
        internalInstance.couchWorkingDir,
        options,
        internalInstance.bootstrapCallback.bind(internalInstance, resolve, reject)
      )
    })
  }

  configureCouch () {
    const internalInstance = CouchDBBootstrapInternal.getInstance(this.couchdbFolderPath, this.couchdbUrl)
    return request.get(`${internalInstance.getBaseUrl()}/_membership`, {json: true})
      .then(internalInstance.getConfigByNode.bind(internalInstance))
      .then(internalInstance.pushToCouch.bind(internalInstance))
      .catch((error) => {
        if (error.statusCode === 400) {
          const settings = internalInstance.getConfigWithoutNode()
          return internalInstance.pushToCouch(settings)
        }
        return error
      })
  }

  createWorkingDir () {
    const internalInstance = CouchDBBootstrapInternal.getInstance(this.couchdbFolderPath, this.couchdbUrl)
    return internalInstance.removeWorkingDir.bind(internalInstance)()
      .then(internalInstance.createWorkingDir.bind(internalInstance))
      .then(internalInstance.cleanCodeFiles.bind(internalInstance))
      .then(internalInstance.setUpUsers.bind(internalInstance))
  }

  removeWorkingDir () {
    const internalInstance = CouchDBBootstrapInternal.getInstance(this.couchdbFolderPath, this.couchdbUrl)
    return internalInstance.removeWorkingDir()
  }

  runAllSetup () {
    this.ensureDBSetup()
      .then(this.createWorkingDir.bind(this))
      .then(resp => console.log(resp))
      .then(this.bootstrap.bind(this))
      .then(response => console.log(response))
      .then(this.configureCouch.bind(this))
      .then(response => console.log(response))
      .catch(err => console.log(err))
      .finally(() => {
        this.removeWorkingDir()
          .catch(error => console.log(`error removing working dir ${error.message}`))
      })
  }

  static getInstance (couchDBOptions) {
    bootstrapInstance = bootstrapInstance || new CouchDBBootstrap(couchDBOptions)
    return bootstrapInstance
  }
}

export default CouchDBBootstrap
