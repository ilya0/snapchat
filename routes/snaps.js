module.exports = Snaps

var debug = require('debug')('snapchat:snaps')
var Promise = require('bluebird')

var constants = require('../lib/constants')
var StringUtils = require('../lib/string-utils')
var Request = require('../lib/request')

var SnapOptions = require('../models/snap-options')
var SKBlob = require('../models/blob')
var SKLocation = require('../models/location')

/**
 * Snapchat wrapper for Snap-related API calls.
 *
 * @class
 * @param {Object} opts
 */
function Snaps (client, opts) {
  var self = this
  if (!(self instanceof Snaps)) return new Snaps(client, opts)
  if (!opts) opts = {}

  self.client = client
}

/**
 * Sends a snap to everyone in recipients with text text for duration seconds.
 *
 * @param {SKBlob} blob The SKBlob object containing the image or video data to send. Can be created with any NSData object.
 * @param {Array<string>|string} recipients An array of username strings.
 * @param {string} text The text to label the snap with. This text is not superimposed upon the image; you must do that yourself.
 * @param {number} duration The length of the snap. It must be greater than 0 or an exception will be raised.
 * @param {function} cb
 */
Snaps.prototype.sendSnap = function (blob, recipients, text, duration, cb) {
  var self = this
  debug('Snaps.sendSnap')

  return self.sendSnapCustom(blob, new SnapOptions(recipients, text, duration), cb)
}

/**
 * Sends a snap with the given options.
 *
 * @param {SKBlob} blob The SKBlob object containing the image or video data to send. Can be created with any Buffer.
 * @param {SnapOptions} opts The options for the snap to be sent.
 * @param {function} cb
 */
Snaps.prototype.sendSnapCustom = function (blob, opts, cb) {
  var self = this

  return new Promise(function (resolve, reject) {
    debug('Snaps.sendSnapCustom')

    self._uploadSnap(blob, function (err, mediaID) {
      if (err) {
        return reject(err)
      }

      self.client.post(constants.endpoints.snaps.send, {
        'camera_front_facing': !!opts.cameraFrontFacing,
        'country_code': self.client.session.countryCode,
        'media_id': mediaID,
        'recipients': JSON.stringify(opts.recipients),
        'recipient_ids': JSON.stringify(opts.recipients),
        'reply': !!opts.isReply,
        'time': +opts.timer,
        'zipped': 0,
        'username': self.client.username
      }, function (err, result) {
        if (err) {
          return reject(err)
        }
        return resolve(result)
      })
    })
  }).nodeify(cb)
}

/**
 * Marks a snap as opened for secondsViewed seconds.
 *
 * @param {number} secondsViewed The number of seconds the snap was viewed for.
 * @param {function} cb
 */
Snaps.prototype.markSnapViewed = function (snap, secondsViewed, cb) {
  var self = this
  debug('Snaps.markSnapViewed')

  return self.markSnapsViewed([ snap ], [ new Date() ], [ secondsViewed ], cb)
}

/**
 * Marks a set of snaps as opened for the specified length at the given times.
 *
 * @param {Array<SKSnap>} snaps An array of SKSnap objects.
 * @param {Array<Date>} times An array of Date objects.
 * @param {Array<number>} secondsViewed An array of numbers.
 * @param {function} cb
 */
Snaps.prototype.markSnapsViewed = function (snaps, times, secondsViewed, cb) {
  var self = this
  debug('Snaps.markSnapsViewed')

  if (snaps.length !== times.length || times.length !== secondsViewed.length) {
    throw new Error('Snaps.markSnapsViewed all arrays must have the same length')
  }

  var json = { }

  snaps.forEach(function (snap, index) {
    json[snap.identifier] = {
      't': StringUtils.timestampFrom(times[index]),
      'sv': secondsViewed[index]
    }
  })

  return self.client.post(constants.endpoints.update.snaps, {
    'added_friends_timestamp': StringUtils.timestampFrom(self.session.addedFriendsTimestamp),
    'username': self.client.username,
    'json': JSON.stringify(json)
  }, cb)
}

/**
 * Marks a snap as screenshotted and viewed for secondsViewed seconds.
 *
 * @param {number} secondsViewed The number of seconds the snap was viewed for.
 * @param {function} cb
 */
Snaps.prototype.markSnapScreenshot = function (snap, secondsViewed, cb) {
  var self = this
  debug('Snaps.markSnapScreenshot')

  var timestamp = StringUtils.timestamp()
  var snapInfo = { }

  snapInfo[snap.identifier] = {
    't': timestamp | 0,
    'sv': secondsViewed,
    'c': constants.SnapStatus.Screenshot
  }

  var screenshot = {
    'eventName': 'SNAP_SCREENSHOT',
    'params': {
      'id': snap.identifier
    },
    'ts': StringUtils.timestamp() | 0
  }

  return self.client.sendEvents([ screenshot ], snapInfo, cb)
}

/**
 * Loads a snap.
 *
 * @param {Snap} snap
 * @param {function} cb
 */
Snaps.prototype.loadSnap = function (snap, cb) {
  var self = this
  debug('Snaps.loadSnap')

  return self._loadSnapWithIdentifier(snap.identifier, cb)
}

/**
 * Loads filters for a location.
 *
 * @param {Object} location { lat, lng }
 * @param {function} cb
 */
Snaps.prototype.loadFiltersForLocation = function (location, cb) {
  var self = this

  return new Promise(function (resolve, reject) {
    debug('Snaps.loadFiltersForLocation')

    self.client.post(constants.endpoints.misc.locationData, {
      'lat': location.lat,
      'lng': location.lng,
      'screen_width': self.client.screenSize.width,
      'screen_height': self.client.screenSize.height,
      'username': self.client.username
    }, function (err, result) {
      if (err) {
        return reject(err)
      } else if (result) {
        return resolve(new SKLocation(result))
      }

      return reject(new Error('Snaps.loadFiltersForLocation parse error'))
    })
  }).nodeify(cb)
}

/**
 * @private
 */
Snaps.prototype._loadSnapWithIdentifier = function (identifier, cb) {
  var self = this

  return new Promise(function (resolve, reject) {
    self.client.post(constants.endpoints.snaps.loadBlob, {
      'id': identifier,
      'username': self.client.username
    }, function (err, body) {
      if (err) {
        return reject(err)
      }

      SKBlob.initWithData(body, function (err, blob) {
        if (err) {
          return reject(err)
        }
        return resolve(blob)
      })
    })
  }).nodeify(cb)
}

/**
 * @private
 * @param {SKBlob} blob
 * @param {function} cb
 */
Snaps.prototype._uploadSnap = function (blob, cb) {
  var self = this
  var uuid = StringUtils.mediaIdentifier(self.client.username)

  if (!(blob instanceof SKBlob)) {
    throw new Error('Snap._uploadSnap invalid argument "blob" must be SKBlob instance')
  }

  var params = {
    'media_id': uuid,
    'type': blob.isImage ? constants.MediaKind.Image.value : constants.MediaKind.Video.value,
    'data': blob.data,
    'zipped': 0,
    'features_map': '{}',
    'username': self.client.username
  }

  var headers = { }
  headers[constants.headers.clientAuthToken] = 'Bearer ' + self.client.googleAuthToken
  headers[constants.headers.contentType] = 'multipart/form-data; boundary=' + constants.core.boundary

  Request.postCustom(constants.endpoints.snaps.upload, params, headers, self.client.authToken, function (err) {
    if (err) {
      return cb(err)
    } else {
      return cb(null, uuid)
    }
  })
}
