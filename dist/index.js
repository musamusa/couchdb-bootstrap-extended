'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _fs = require('fs.extra');

var _fs2 = _interopRequireDefault(_fs);

var _url = require('url');

var _url2 = _interopRequireDefault(_url);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _util = require('util');

var _util2 = _interopRequireDefault(_util);

var _couchdbBootstrap = require('couchdb-bootstrap');

var _couchdbBootstrap2 = _interopRequireDefault(_couchdbBootstrap);

var _bluebird = require('bluebird');

var _bluebird2 = _interopRequireDefault(_bluebird);

var _requestPromise = require('request-promise');

var _requestPromise2 = _interopRequireDefault(_requestPromise);

var _couchdbEnsure = require('couchdb-ensure');

var _couchdbEnsure2 = _interopRequireDefault(_couchdbEnsure);

var _nodeCodeUtility = require('node-code-utility');

var _nodeCodeUtility2 = _interopRequireDefault(_nodeCodeUtility);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var instance = void 0;
var bootstrapInstance = void 0;
var filesToDelete = [];

var CouchDBBootstrapInternal = function () {
  function CouchDBBootstrapInternal(couchdbFolderPath, couchdbUrl) {
    _classCallCheck(this, CouchDBBootstrapInternal);

    this.couchAppDir = _path2.default.join(couchdbFolderPath, 'app');
    this.couchWorkingDir = _path2.default.join(couchdbFolderPath, '_app_');
    this.userDir = _path2.default.join(this.couchWorkingDir, '_users');
    this.dbUrl = couchdbUrl;
  }

  _createClass(CouchDBBootstrapInternal, [{
    key: 'getBaseUrl',
    value: function getBaseUrl() {
      var urlParts = _url2.default.parse(this.dbUrl);
      delete urlParts.path;
      delete urlParts.pathname;
      return _url2.default.format(urlParts);
    }
  }, {
    key: 'ensureDB',
    value: function ensureDB(db) {
      return new _bluebird2.default(function (resolve, reject) {
        (0, _couchdbEnsure2.default)(db, function (error, response) {
          if (error) {
            return reject(error);
          }
          return resolve(response);
        });
      });
    }
  }, {
    key: 'compileConfig',
    value: function compileConfig(allSettings, filePath, node) {
      if (!_fs2.default.existsSync(filePath)) {
        return allSettings;
      }
      var config = require(filePath);
      var settings = this.formatConfigData(config, node);
      return allSettings.concat(settings);
    }
  }, {
    key: 'getConfigByNode',
    value: function getConfigByNode(response) {
      var allSettings = [];
      if (response.cluster_nodes && response.cluster_nodes.length > 0) {
        var i = response.cluster_nodes.length;
        while (i--) {
          var node = response.cluster_nodes[i];
          var filePath = _path2.default.join(this.couchWorkingDir, '_node', node, '_config.json');
          var fallbackPath = _path2.default.join(this.couchWorkingDir, '_node', '_config.json');
          if (_fs2.default.existsSync(filePath)) {
            allSettings = this.compileConfig(allSettings, filePath, node);
          } else {
            allSettings = this.compileConfig(allSettings, fallbackPath, node);
          }
        }
      }
      return allSettings;
    }
  }, {
    key: 'getConfigWithoutNode',
    value: function getConfigWithoutNode() {
      var settings = [];
      var filePath = _path2.default.join(this.couchWorkingDir, '_node', '_config.json');
      if (_fs2.default.existsSync(filePath)) {
        var config = require(filePath);
        settings = this.formatConfigData(config);
      }
      return settings;
    }
  }, {
    key: 'formatConfigData',
    value: function formatConfigData(config, node) {
      return Object.keys(config).reduce(function (memo, key) {
        if (_typeof(config[key]) !== 'object') return memo;

        var section = Object.keys(config[key]).map(function (k) {
          var nodePath = node ? '_node/' + node + '/' : '';
          return {
            path: nodePath + '_config/' + encodeURIComponent(key) + '/' + encodeURIComponent(k),
            value: config[key][k].toString()
          };
        });

        return memo.concat(section);
      }, []);
    }
  }, {
    key: 'pushToCouch',
    value: function pushToCouch(settings) {
      var _this = this;

      var responseMapping = {};
      return _bluebird2.default.mapSeries(settings, function (setting) {
        var params = {
          url: '' + _this.getBaseUrl() + setting.path,
          body: setting.value,
          json: true
        };
        return _requestPromise2.default.put(params).then(function (response) {
          responseMapping[setting.path] = response;
          return response;
        });
      }).then(function () {
        return responseMapping;
      });
    }
  }, {
    key: 'mapDBName',
    value: function mapDBName(baseName) {
      var baseDir = _path2.default.join(this.couchWorkingDir, baseName, '/_design/');
      if (_fs2.default.existsSync(baseDir)) {
        var dirList = _fs2.default.readdirSync(baseDir);
        var i = dirList.length;
        while (i--) {
          var topSubDir = _path2.default.join(baseDir, dirList[i], 'views');
          if (_fs2.default.existsSync(topSubDir)) {
            var subDirList = _fs2.default.readdirSync(topSubDir);
            var j = subDirList.length;
            while (j--) {
              var mapCodeFilePath = _path2.default.join(topSubDir, subDirList[j], 'map-code.js');
              var reduceCodeFilePath = _path2.default.join(topSubDir, subDirList[j], 'reduce-code.js');
              var mapFile = _path2.default.join(topSubDir, subDirList[j], 'map.js');
              if (_fs2.default.existsSync(mapCodeFilePath) && filesToDelete.indexOf(mapFile) === -1) {
                var mapContent = require(mapCodeFilePath).map.toString();
                // filesToDelete.push(mapFile)
                _fs2.default.writeFileSync(mapFile, mapContent);
                _fs2.default.unlinkSync(mapCodeFilePath);
              }

              if (_fs2.default.existsSync(reduceCodeFilePath)) {
                var reduceFile = _path2.default.join(topSubDir, subDirList[j], 'reduce.js');
                var reduceContent = require(reduceCodeFilePath).reduce.toString();
                _fs2.default.writeFileSync(reduceFile, reduceContent);
                _fs2.default.unlinkSync(reduceCodeFilePath);
              }
            }
          }
        }
      }
      return baseName;
    }
  }, {
    key: 'cleanCodeFiles',
    value: function cleanCodeFiles() {
      var dirList = _fs2.default.readdirSync(this.couchWorkingDir);
      var length = dirList.length;
      while (length--) {
        var dir = dirList[length];
        this.mapDBName(dir);
      }
    }
  }, {
    key: 'bootstrapCallback',
    value: function bootstrapCallback(resolve, reject, err, res) {
      var length = filesToDelete.length;
      while (length--) {
        try {
          _fs2.default.unlinkSync(filesToDelete[length]);
        } catch (e) {}
      }
      filesToDelete = [];
      this.deleteFolderRecursive(_path2.default.join(this.couchWorkingDir, '_users'));
      if (err) {
        reject(err);
      }
      // Untruncate
      res = _util2.default.inspect(res, {
        depth: null
      });
      resolve(res);
    }
  }, {
    key: 'setUpUsers',
    value: function setUpUsers() {
      var userDocDir = _path2.default.join(this.couchWorkingDir, '_users_doc');
      try {
        _fs2.default.mkdirRecursiveSync(this.userDir);
      } catch (e) {
        console.log('file create error', e);
      }
      if (_fs2.default.existsSync(userDocDir)) {
        var userFileList = _fs2.default.readdirSync(userDocDir);
        var ui = userFileList.length;
        while (ui--) {
          var userFilePath = _path2.default.join(userDocDir, userFileList[ui]);
          var userJSONPath = _path2.default.join(this.userDir, userFileList[ui].replace('.json', '').replace('.js', '.json'));
          if (filesToDelete.indexOf(userJSONPath) === -1) {
            var userContent = JSON.stringify(require(userFilePath).user);
            _fs2.default.writeFileSync(userJSONPath, userContent);
          }
        }
        _fs2.default.rmrfSync(userDocDir);
      }
    }
  }, {
    key: 'deleteFolderRecursive',
    value: function deleteFolderRecursive(path) {
      var _this2 = this;

      if (_fs2.default.existsSync(path)) {
        _fs2.default.readdirSync(path).forEach(function (file) {
          var curPath = path + '/' + file;
          if (_fs2.default.lstatSync(curPath).isDirectory()) {
            _this2.deleteFolderRecursive(curPath);
          } else {
            _fs2.default.unlinkSync(curPath);
          }
        });
        _fs2.default.rmdirSync(path);
      }
    }
  }, {
    key: 'createWorkingDir',
    value: function createWorkingDir() {
      var _this3 = this;

      return new _bluebird2.default(function (resolve, reject) {
        _fs2.default.copyRecursive(_this3.couchAppDir, _this3.couchWorkingDir, function (error) {
          if (error) {
            return reject(error);
          }
          return resolve({ message: 'copied' });
        });
      });
    }
  }, {
    key: 'removeWorkingDir',
    value: function removeWorkingDir() {
      var _this4 = this;

      return new _bluebird2.default(function (resolve, reject) {
        _fs2.default.rmrf(_this4.couchWorkingDir, function (error) {
          if (error) {
            return reject(error);
          }
          return resolve({ message: 'removed' });
        });
      });
    }
  }], [{
    key: 'getInstance',
    value: function getInstance(couchdbFolderPath, couchdbUrl) {
      instance = instance || new CouchDBBootstrapInternal(couchdbFolderPath, couchdbUrl);
      return instance;
    }
  }]);

  return CouchDBBootstrapInternal;
}();

var CouchDBBootstrap = function () {
  function CouchDBBootstrap(couchDBOptions) {
    _classCallCheck(this, CouchDBBootstrap);

    this.options = _nodeCodeUtility2.default.is.object(couchDBOptions) ? couchDBOptions : {};
    this.options.db = this.options.db || 'localDB';
    this.options.dbOptions = _nodeCodeUtility2.default.is.object(this.options.dbOptions) ? this.options.dbOptions : {};

    this.couchdbUrl = this.getDBFUllUrl();
    this.couchdbFolderPath = this.options.couchdbFolderPath;
  }

  _createClass(CouchDBBootstrap, [{
    key: 'getDBBaseUrl',
    value: function getDBBaseUrl() {
      var urlObject = new _url2.default.URL(this.options.host);
      if (this.options.auth && _nodeCodeUtility2.default.is.object(this.options.auth) && this.options.auth.username && this.options.auth.password) {
        urlObject.auth = this.options.auth.username + ':' + this.options.auth.password;
      }
      urlObject.path = '';
      urlObject.pathname = '';
      urlObject.port = this.options.port || 80;
      return _url2.default.format(urlObject);
    }
  }, {
    key: 'getDBFUllUrl',
    value: function getDBFUllUrl() {
      var urlObject = new _url2.default.URL(this.getDBBaseUrl());
      urlObject.path = '/' + this.options.db;
      urlObject.pathname = urlObject.path;
      return _url2.default.format(urlObject);
    }
  }, {
    key: 'ensureDBSetup',
    value: function ensureDBSetup() {
      var internalInstance = CouchDBBootstrapInternal.getInstance(this.couchdbFolderPath, this.couchdbUrl);
      var userDB = [internalInstance.getBaseUrl(), '_users'].join('');
      var replicator = [internalInstance.getBaseUrl(), '_replicator'].join('');
      var globalChanges = [internalInstance.getBaseUrl(), '_global_changes'].join('');
      var metadata = [internalInstance.getBaseUrl(), '_metadata'].join('');
      var dbUrl = this.couchdbUrl;
      var dbList = [userDB, replicator, globalChanges, metadata, dbUrl];

      return _bluebird2.default.mapSeries(dbList, function (db) {
        if (db.indexOf('_global_changes')) {
          return internalInstance.ensureDB(db).catch(_bluebird2.default.resolve);
        }
        return internalInstance.ensureDB(db);
      });
    }
  }, {
    key: 'bootstrap',
    value: function bootstrap() {
      var options = { mapDbName: {} };
      var isObject = Object.prototype.toString.call(this.options.dbOptions) === '[object Object]';
      var internalInstance = CouchDBBootstrapInternal.getInstance(this.couchdbFolderPath, this.couchdbUrl);

      if (isObject && this.options.dbOptions.src && this.options.dbOptions.target) {
        options.mapDbName[this.options.dbOptions.src] = this.options.dbOptions.target;
      }

      return new _bluebird2.default(function (resolve, reject) {
        (0, _couchdbBootstrap2.default)({
          url: internalInstance.getBaseUrl()
        }, internalInstance.couchWorkingDir, options, internalInstance.bootstrapCallback.bind(internalInstance, resolve, reject));
      });
    }
  }, {
    key: 'configureCouch',
    value: function configureCouch() {
      var internalInstance = CouchDBBootstrapInternal.getInstance(this.couchdbFolderPath, this.couchdbUrl);
      return _requestPromise2.default.get(internalInstance.getBaseUrl() + '/_membership', { json: true }).then(internalInstance.getConfigByNode.bind(internalInstance)).then(internalInstance.pushToCouch.bind(internalInstance)).catch(function (error) {
        if (error.statusCode === 400) {
          var settings = internalInstance.getConfigWithoutNode();
          return internalInstance.pushToCouch(settings);
        }
        return error;
      });
    }
  }, {
    key: 'createWorkingDir',
    value: function createWorkingDir() {
      var internalInstance = CouchDBBootstrapInternal.getInstance(this.couchdbFolderPath, this.couchdbUrl);
      return internalInstance.removeWorkingDir.bind(internalInstance)().then(internalInstance.createWorkingDir.bind(internalInstance)).then(internalInstance.cleanCodeFiles.bind(internalInstance)).then(internalInstance.setUpUsers.bind(internalInstance));
    }
  }, {
    key: 'removeWorkingDir',
    value: function removeWorkingDir() {
      var internalInstance = CouchDBBootstrapInternal.getInstance(this.couchdbFolderPath, this.couchdbUrl);
      return internalInstance.removeWorkingDir();
    }
  }, {
    key: 'runAllSetup',
    value: function runAllSetup() {
      var _this5 = this;

      this.ensureDBSetup().then(this.createWorkingDir.bind(this)).then(function (resp) {
        return console.log(resp);
      }).then(this.bootstrap.bind(this)).then(function (response) {
        return console.log(response);
      }).then(this.configureCouch.bind(this)).then(function (response) {
        return console.log(response);
      }).catch(function (err) {
        return console.log(err);
      }).finally(function () {
        _this5.removeWorkingDir().catch(function (error) {
          return console.log('error removing working dir ' + error.message);
        });
      });
    }
  }], [{
    key: 'getInstance',
    value: function getInstance(couchDBOptions) {
      bootstrapInstance = bootstrapInstance || new CouchDBBootstrap(couchDBOptions);
      return bootstrapInstance;
    }
  }]);

  return CouchDBBootstrap;
}();

exports.default = CouchDBBootstrap;