let Service, Characteristic
const packageJson = require('./package.json')
const request = require('request')
const ip = require('ip')
const http = require('http')

module.exports = function (homebridge) {
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  homebridge.registerAccessory('homebridge-web-lock', 'HTTPLock', HTTPLock)
}

function HTTPLock (log, config) {
  this.log = log

  this.name = config.name
  this.shellyIp = config.shellyIp
  this.shellyChannel = config.shellyChannel
  this.pollInterval = config.pollInterval || 300

  this.port = config.port || 2000
  this.requestArray = ['lockTargetState', 'lockCurrentState']

  this.autoLock = config.autoLock || false
  this.autoLockDelay = config.autoLockDelay || 10

  this.manufacturer = config.manufacturer || packageJson.author
  this.serial = config.serial || packageJson.version
  this.model = config.model || packageJson.name
  this.firmware = config.firmware || packageJson.version

  this.username = config.username || null
  this.password = config.password || null
  this.timeout = config.timeout || 3000
  this.http_method = config.http_method || 'GET'

  if (this.username != null && this.password != null) {
    this.auth = {
      user: this.username,
      pass: this.password
    }
  }

  this.server = http.createServer(function (request, response) {
    const baseURL = 'http://' + request.headers.host + '/'
    const url = new URL(request.url, baseURL)
    if (this.requestArray.includes(url.pathname.substr(1))) {
      try {
        this.log.debug('Handling request')
        response.end('Handling request')
        this._httpHandler(url.pathname.substr(1), url.searchParams.get('value'))
      } catch (e) {
        this.log.warn('Error parsing request: %s', e.message)
      }
    } else {
      this.log.warn('Invalid request: %s', request.url)
      response.end('Invalid request')
    }
  }.bind(this))

  this.server.listen(this.port, function () {
    this.log('Listen server: http://%s:%s', ip.address(), this.port)
  }.bind(this))

  this.service = new Service.LockMechanism(this.name)
}

HTTPLock.prototype = {

  identify: function (callback) {
    this.log('Identify requested!')
    callback()
  },

  _getStatus: function (callback) {
    const url = this.shellyIp + '/relay/' + this.shellyChannel
    this.log.debug('Getting status: %s', url)
    this._httpRequest(url, '', 'GET', function (error, response, responseBody) {
      if (error) {
        this.log.warn('Error getting status: %s', error.message)
        this.service.getCharacteristic(Characteristic.LockCurrentState).updateValue(new Error('Error getting status'))
        callback(error)
      } else {
        this.log.debug('Device response: %s', responseBody)
        try {
          const json = JSON.parse(responseBody)
          this.service.getCharacteristic(Characteristic.LockCurrentState).updateValue(json.ison)
          this.log.debug('Updated lockCurrentState to: %s', json.ison)
          //this.service.getCharacteristic(Characteristic.LockTargetState).updateValue(json.lockTargetState)
          //this.log.debug('Updated lockTargetState to: %s', json.lockTargetState)
          callback()
        } catch (e) {
          this.log.warn('Error parsing status: %s', e.message)
        }
      }
    }.bind(this))
  },

  _httpHandler: function (characteristic, value) {
    switch (characteristic) {
      case 'lockCurrentState': {
        this.service.getCharacteristic(Characteristic.LockCurrentState).updateValue(value)
        this.log('Updated %s to: %s', characteristic, value)
        break
      }
      case 'lockTargetState': {
        this.service.getCharacteristic(Characteristic.LockTargetState).updateValue(value)
        this.log('Updated %s to: %s', characteristic, value)
        if (parseInt(value) === 0 && this.autoLock) {
          this.autoLockFunction()
        }
        break
      }
      default: {
        this.log.warn('Unknown characteristic "%s" with value "%s"', characteristic, value)
      }
    }
  },

  _httpRequest: function (url, body, method, callback) {
    request({
      url: url,
      body: body,
      method: this.http_method,
      timeout: this.timeout,
      rejectUnauthorized: false,
      auth: this.auth
    },
    function (error, response, body) {
      callback(error, response, body)
    })
  },

  setLockTargetState: function (value, callback) {
    if(value == 0) { targetString = 'off' } else if(value == 1) { targetString = 'on'}
    const url = this.shellyIp + '/' + this.shellyChannel + '?turn=' + targetString
    this.log.debug('Setting lock output: %s', url)
    this._httpRequest(url, '', this.http_method, function (error, response, responseBody) {
      if (error) {
        this.log.warn('Error setting lock output: %s', error.message)
        callback(error)
      } else {
        this.log('Set lock output to ' + targetString)
        if (value === 0 && this.autoLock) {
          this.autoLockFunction()
        }
        callback()
      }
    }.bind(this))
  },

  autoLockFunction: function () {
    this.log('Waiting %s seconds for autolock', this.autoLockDelay)
    setTimeout(() => {
      this.service.setCharacteristic(Characteristic.LockTargetState, 1)
      this.log('Autolocking...')
    }, this.autoLockDelay * 1000)
  },

  getServices: function () {
    this.informationService = new Service.AccessoryInformation()
    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.serial)
      .setCharacteristic(Characteristic.FirmwareRevision, this.firmware)

    this.service
      .getCharacteristic(Characteristic.LockTargetState)
      .on('set', this.setLockTargetState.bind(this))

    this._getStatus(function () {})

    setInterval(function () {
      this._getStatus(function () {})
    }.bind(this), this.pollInterval * 1000)

    return [this.informationService, this.service]
  }
}
