
var archiver = require('archiver')
var p = require('path')
var debug = require('debug')('explorer:routes:tree')

import {higherPath, extend, buildUrl, secureString} from '../lib/utils.js'
import {sort} from '../lib/sort.js'
import { tree } from '../lib/tree.js'
import { searchMethod } from '../lib/search.js'

/**
 * Prepare tree locals et validate queries 
 * @param config
 * @return function middleware(req, res, next)
 */
function prepareTree(config) {
  return function(req, res, next) {
    //should be an app.param
    if(!req.query.page || req.query.page < 0)
      req.query.page = 1

    req.query.page = parseInt(req.query.page)

    if(req.query.sort) {
      if(!sort.hasOwnProperty(req.query.sort)) {
        req.query.sort = null 
      }
    }

    if(!~['asc', 'desc'].indexOf(req.query.order)) {
      req.query.order = 'asc' 
    }

    if(!req.query.path)
      req.query.path = './'
    
    if(req.query.search && config.search.method !== 'native') {
      req.query.search = secureString(req.query.search)
    }

    res.locals = extend(res.locals, {
      search: req.query.search,
      sort: req.query.sort || '',
      order: req.query.order || '',
      page: req.query.page,
      root: p.resolve(req.user.home),
      path: higherPath(req.user.home, req.query.path),
      parent: higherPath(req.user.home, p.resolve(req.query.path, '..')),
      buildUrl: buildUrl
    })

    req.options = extend(
      res.locals,
      config.tree, 
      config.pagination
    )

    if(res.locals.sort)
      req.options.sortMethod = sort[res.locals.sort](req.options)

    debug('Options: %o', req.options)

    return next()
  }
}

/**
 * Compress paths with archiver
 * @route /compress
 */
function compress(req, res) {

  let paths = []

  if(typeof req.body.zip == 'string')
    req.body.zip = [req.body.zip]

  //validating paths
  for(let i in req.body.zip) {
    let path = higherPath(req.user.home, req.body.zip[i]) 

    if(path != req.user.home) {
      try {
        var stat = fs.statSync(path)
      } catch(err) {
        return res.status(500).send(err)
      }

      if(stat.isDirectory()) {
        return res.status(501).send('Can not compress a directory')
      }

      paths.push(path)
    }
  }

  let archive = archiver('zip') 
  let name = req.body.name || 'archive'+new Date().getTime()

  archive.on('error', function(err) {
    return res.status(500).send({error: err.message})
  })

  //on stream closed we can end the request
  res.on('close', function() {
    console.log('Archive wrote %d bytes', archive.pointer())
    return res.status(200).send('OK')
  })

  //set the archive name
  res.attachment(`${name}.zip`)

  //this is the streaming magic
  archive.pipe(res)

  for(let i in paths) {
    archive.append(fs.createReadStream(paths[i]), {name: p.basename(paths[i])}) 
  }

  archive.finalize()
}

/**
 * @route /download
 */
function download(req, res) {
  let path = higherPath(req.user.home, req.query.path)

  if(path === req.user.home) {
    return res.send(401, 'Unauthorized') 
  }

  return res.download(path, p.basename(path), function(err) {
    if(err) {
      console.error('Error %o', err)
      console.error('With headers %o', res.headersSent)
      return res.send(500, 'Error while downloading') 
    } 
  })
} 

/**
 * Get the tree
 * @route /
 */
function getTree(req, res) {

  debug('Sort by %s %s', req.options.sort, req.options.order)

  tree(req.options.path, req.options)
  .then(function(e) {
    return res.renderBody('tree.haml', e)
  })
  .catch(function(error) {
    console.error(error)
    return res.status(500).send('Error while parsing tree at path: ' + req.options.path) 
  })
}

/**
 * Search through config search method
 * @route /search
 */
function search(req, res) {
  let config = req.config

  debug('Search with %s', config.search.method, req.options.search)

  searchMethod(config.search.method, config)(req.options.search, req.user.home)
  .then(function(data) {
    data = data ? data : this.data.out
    return tree([].concat.apply([], data), req.options)
  })
  .then(function(e) {
    return res.renderBody('tree.haml', extend(e, {search: req.query.search}))
  })
}

var Tree = function(app) {
  let pt = prepareTree(app.get('config'))

  app.get('/', pt, getTree)
  app.get('/search', pt, search)
  app.get('/download', download)
  app.post('/compress', compress)

  return app
}

export {Tree}
