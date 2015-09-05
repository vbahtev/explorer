import p from 'path'
import http from 'http'
import https from 'https'
import Promise from 'bluebird'
import interactor from './lib/job/interactor.js'

import {firstExistingPath} from './lib/utils.js'
import {getConfiguration} from './lib/config.js'

let fs = Promise.promisifyAll(require('fs'))

var argv = require('minimist')(process.argv.slice(2))

try {
  let config_path = firstExistingPath([
    argv.c,
    p.join(process.env.HOME || '', './.config/explorer/config.yml'), 
    p.join(__dirname, './config.yml')
  ])

  var config = getConfiguration(config_path)
} catch(e) {
  console.log('No config file!')
  throw e
}

let https_options = {
  key: fs.readFileSync(config.https.key),
  cert: fs.readFileSync(config.https.cert)
}

require('./server.js')(config)
.then(function(app) {
  http.createServer(app).listen(config.port, e => !config.quiet ? console.log('HTTP listening on %s', config.port) : 1)

  if(config.https.enabled) {
    https.createServer(https_options, app).listen(config.https.port, e => !config.quiet ? console.log('HTTPS listening on %s', config.https.port) : 1)
  }
  
  var plugins = app.get('plugins')
  var plugins_paths = []

  for(var i in plugins) {
    if('job' in plugins[i]) {
      plugins_paths.push(plugins[i].path) 
    }
  }

  if(interactor.job) {
    console.error('Interactor already launched')
    return Promise.resolve()
  }

  return interactor.run(plugins_paths)

}) 
.catch(function(err) {
  console.error('Error while initializing explorer') 
  console.error(err.stack)
})
