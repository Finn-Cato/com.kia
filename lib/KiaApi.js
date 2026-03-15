'use strict';

/**
 * KiaApi  thin wrapper around the `bluelinky` package.
 *
 * bluelinky handles OAuth token acquisition / refresh internally.
 * We only need to re-create the client if credentials change (repair flow).
 */

const https  = require('https');
const _mod   = require('bluelinky');
const BlueLinky = _mod.default || _mod;

const CONNECT_TIMEOUT_MS = 30000;

class KiaApi {

  /**
   * @param {object} opts
   * @param {string} opts.username   - Kia Connect email
   * @param {string} opts.password   - Kia Connect password (or EU refresh token)
   * @param {string} opts.region     - 'EU' | 'US' | 'CA' | 'AU'
   * @param {string} [opts.pin]      - Kia Connect PIN (required for remote commands)
   * @param {string} [opts.brand]    - 'kia' (default)
   */
  constructor({ username, password, region, pin = '', brand = 'kia', logger = null }) {
    this._credentials = { username, password, region, pin, brand };
    this._log = logger || console.log.bind(console);
    this._client = null;
    this._vehicles = [];
    this._ready = false;
  }

  // -- connection --

  /**
   * EU note: Kia Europe now requires Google reCAPTCHA during password login,
   * so direct password auth fails with 401/4010. When the user supplies a
   * refresh token instead of a password (detected by length > 50 chars) we
   * skip BlueLinky login() entirely and exchange via Node built-in https.
   */
  connect() {
    if (this._ready) return Promise.resolve(this._vehicles);

    const { username, password, region, pin, brand } = this._credentials;

    this._log('[KiaApi] connect() region=' + region + ' passwordLength=' + (password ? password.length : 0));

    if (region === 'EU' && password && password.length > 50) {
      this._log('[KiaApi] EU refresh-token path triggered');
      return this._connectWithRefreshToken(password);
    }

    this._log('[KiaApi] Standard bluelinky login path (region=' + region + ' passLen=' + (password ? password.length : 0) + ')');  

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Kia API connection timed out (30 s). Check your credentials and region.'));
      }, CONNECT_TIMEOUT_MS);

      this._client = new BlueLinky({ username, password, brand, region, pin });

      this._client.on('ready', (vehicles) => {
        clearTimeout(timer);
        this._vehicles = vehicles;
        this._ready = true;
        resolve(vehicles);
      });

      this._client.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(err.message || String(err)));
      });
    });
  }

  async _connectWithRefreshToken(refreshToken) {
    const { username, region, pin, brand } = this._credentials;
    const env = this._getEUEnvironment(brand);

    this._log('[KiaApi] _connectWithRefreshToken tokenUrl=' + env.tokenUrl);

    const body = [
      'grant_type=refresh_token',
      'redirect_uri=' + encodeURIComponent('https://www.getpostman.com/oauth2/callback'),
      'refresh_token=' + encodeURIComponent(refreshToken),
    ].join('&');

    let tokenData;
    try {
      tokenData = await this._httpsPost(env.tokenUrl, env.host, env.basicToken, body);
      this._log('[KiaApi] token exchange OK, accessToken prefix=' + (tokenData.access_token || '').substring(0, 20));
    } catch (err) {
      this._log('[KiaApi] token exchange FAILED: ' + err.message);
      throw err;
    }

    const accessToken = 'Bearer ' + tokenData.access_token;
    this._client = new BlueLinky({
      username,
      password:  refreshToken,
      brand,
      region,
      pin,
      autoLogin: false,
    });

    const session = this._client.getSession();
    session.accessToken    = accessToken;
    session.refreshToken   = refreshToken;
    session.tokenExpiresAt = Math.floor(Date.now() / 1000 + (tokenData.expires_in || 3600));

    this._vehicles = await this._client.getVehicles();
    this._ready = true;
    return this._vehicles;
  }

  _httpsPost(url, host, authorization, body) {
    const parsed = new URL(url);
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: parsed.hostname,
        port:     Number(parsed.port) || 443,
        path:     parsed.pathname + (parsed.search || ''),
        method:   'POST',
        headers: {
          'Authorization':   authorization,
          'Content-Type':    'application/x-www-form-urlencoded',
          'Host':            host,
          'Connection':      'Keep-Alive',
          'Accept-Encoding': 'gzip',
          'User-Agent':      'okhttp/3.10.0',
          'Content-Length':  Buffer.byteLength(body),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          if (res.statusCode !== 200) {
            reject(new Error(
              'EU refresh token exchange failed (' + res.statusCode + '): ' + raw +
              '. Make sure you pasted the Refresh Token (not the Access Token).'
            ));
            return;
          }
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error('EU token response parse error: ' + raw)); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  _getEUEnvironment(brand) {
    if ((brand || 'kia').toLowerCase() === 'kia') {
      return {
        tokenUrl:   'https://prd.eu-ccapi.kia.com:8080/api/v1/user/oauth2/token',
        basicToken: 'Basic ZmRjODVjMDAtMGEyZi00YzY0LWJjYjQtMmNmYjE1MDA3MzBhOnNlY3JldA==',
        host:       'prd.eu-ccapi.kia.com:8080',
      };
    }
    return {
      tokenUrl:   'https://prd.eu-ccapi.hyundai.com:8080/api/v1/user/oauth2/token',
      basicToken: 'Basic NmQ0NzdjMzgtM2NhNC00Y2YzLTk1NTctMmExOTI5YTk0NjU0OktVeTQ5WHhQekxwTHVvSzB4aEJDNzdXNlZYaG10UVI5aVFobUlGampvWTRJcHhzVg==',
      host:       'prd.eu-ccapi.hyundai.com:8080',
    };
  }

  async getVehicles() {
    await this.connect();
    return this._vehicles;
  }

  // -- helpers --

  _findVehicle(vin) {
    const v = this._vehicles.find(v => {
      const cfg = v.vehicleConfig || v;
      return cfg.vin === vin;
    });
    if (!v) throw new Error('Vehicle VIN ' + vin + ' not found on this account');
    return v;
  }

  // -- status --

  async getStatus(vin, refresh = false) {
    await this.connect();
    const vehicle = this._findVehicle(vin);
    try {
      return await vehicle.status({ refresh });
    } catch (err) {
      if (!refresh) return vehicle.status({ refresh: true });
      throw err;
    }
  }

  // -- commands --

  async lock(vin) {
    await this.connect();
    return this._findVehicle(vin).lock();
  }

  async unlock(vin) {
    await this.connect();
    return this._findVehicle(vin).unlock();
  }

  async startClimate(vin, { temperature = 22, defrost = false, heating = 0, duration = 10 } = {}) {
    await this.connect();
    return this._findVehicle(vin).start({
      airCtrl:        true,
      igniOnDuration: duration,
      airTempvalue:   temperature,
      defrost,
      heating1:       heating,
    });
  }

  async stopClimate(vin) {
    await this.connect();
    return this._findVehicle(vin).stop();
  }

  async startCharge(vin) {
    await this.connect();
    return this._findVehicle(vin).startCharge();
  }

  async stopCharge(vin) {
    await this.connect();
    return this._findVehicle(vin).stopCharge();
  }

}

module.exports = KiaApi;
