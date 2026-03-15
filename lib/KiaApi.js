'use strict';

/**
 * KiaApi — thin wrapper around the `bluelinky` package.
 *
 * bluelinky handles OAuth token acquisition / refresh internally.
 * We only need to re-create the client if credentials change (repair flow).
 */

const _mod = require('bluelinky');
// Handle both CommonJS and TS-compiled default exports
const BlueLinky = _mod.default || _mod;

const CONNECT_TIMEOUT_MS = 30000;

class KiaApi {

  /**
   * @param {object} opts
   * @param {string} opts.username   - Kia Connect email
   * @param {string} opts.password   - Kia Connect password
   * @param {string} opts.region     - 'EU' | 'US' | 'CA' | 'AU'
   * @param {string} [opts.pin]      - Kia Connect PIN (required for remote commands)
   * @param {string} [opts.brand]    - 'kia' (default)
   */
  constructor({ username, password, region, pin = '', brand = 'kia' }) {
    this._credentials = { username, password, region, pin, brand };
    this._client = null;
    this._vehicles = [];
    this._ready = false;
  }

  // ── connection ────────────────────────────────────────────────────────

  /**
   * Initialise the bluelinky client and resolve once the 'ready' event fires.
   * Cached after first call; safe to await multiple times.
   *
   * EU note: Kia Europe now requires Google reCAPTCHA during password login,
   * so direct password auth fails with 401/4010. When the user supplies a
   * refresh token instead of a password (detected by length > 50 chars) we
   * skip BlueLinky's login() and exchange the token directly via
   * refreshAccessToken() — no reCAPTCHA involved.
   */
  connect() {
    if (this._ready) return Promise.resolve(this._vehicles);

    const { username, password, region, pin, brand } = this._credentials;

    // EU refresh-token path: bypass reCAPTCHA-guarded /api/v1/user/signin
    if (region === 'EU' && password.length > 50) {
      return this._connectWithRefreshToken(password);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Kia API connection timed out (30 s). Check your credentials and region.'));
      }, CONNECT_TIMEOUT_MS);

      this._client = new BlueLinky({
        username,
        password,
        brand,
        region,
        pin,
      });

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

  /**
   * EU-only: exchange a refresh token for an access token without going
   * through the reCAPTCHA-guarded password login.
   *
   * bluelinky's EuropeController.refreshAccessToken() posts directly to
   * /api/v1/user/oauth2/token with grant_type=refresh_token, which does not
   * require reCAPTCHA. We just need to seed session.refreshToken first.
   */
  async _connectWithRefreshToken(refreshToken) {
    const { username, region, pin, brand } = this._credentials;

    // Use got directly to exchange refresh token → access token.
    // This completely avoids bluelinky's login() / EuropeController.login flow
    // which hits /api/v1/user/signin and fails with 4010 (reCAPTCHA required).
    const got = require('got');
    const environment = this._getEUEnvironment(brand);

    const body = new URLSearchParams();
    body.append('grant_type', 'refresh_token');
    body.append('redirect_uri', 'https://www.getpostman.com/oauth2/callback');
    body.append('refresh_token', refreshToken);

    const tokenRes = await got(environment.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization:      environment.basicToken,
        'Content-Type':     'application/x-www-form-urlencoded',
        Host:               environment.host,
        Connection:         'Keep-Alive',
        'Accept-Encoding':  'gzip',
        'User-Agent':       'okhttp/3.10.0',
      },
      body:             body.toString(),
      throwHttpErrors:  false,
    });

    if (tokenRes.statusCode !== 200) {
      throw new Error(
        `EU refresh token exchange failed (${tokenRes.statusCode}): ${tokenRes.body}. ` +
        'Make sure you pasted the Refresh Token (not the Access Token) from the script output.'
      );
    }

    const tokenData = JSON.parse(tokenRes.body);
    const accessToken = `Bearer ${tokenData.access_token}`;

    // Now use BlueLinky with autoLogin:false and seed the session manually
    this._client = new BlueLinky({
      username,
      password: refreshToken,
      brand,
      region,
      pin,
      autoLogin: false,
    });

    const session = this._client.getSession();
    session.accessToken  = accessToken;
    session.refreshToken = refreshToken;
    session.tokenExpiresAt = Math.floor(Date.now() / 1000 + tokenData.expires_in);

    this._vehicles = await this._client.getVehicles();
    this._ready = true;
    return this._vehicles;
  }

  _getEUEnvironment(brand = 'kia') {
    const b = (brand || 'kia').toLowerCase();
    if (b === 'kia') {
      return {
        tokenUrl:   'https://prd.eu-ccapi.kia.com:8080/api/v1/user/oauth2/token',
        basicToken: 'Basic ZmRjODVjMDAtMGEyZi00YzY0LWJjYjQtMmNmYjE1MDA3MzBhOnNlY3JldA==',
        host:       'prd.eu-ccapi.kia.com:8080',
      };
    }
    // Hyundai EU fallback
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

  // ── helpers ───────────────────────────────────────────────────────────

  _findVehicle(vin) {
    const v = this._vehicles.find(v => {
      const cfg = v.vehicleConfig || v;
      return cfg.vin === vin;
    });
    if (!v) throw new Error(`Vehicle VIN ${vin} not found on this account`);
    return v;
  }

  // ── status ────────────────────────────────────────────────────────────

  /**
   * @param {string}  vin
   * @param {boolean} [refresh=false] - true = force a live refresh from the car (costs a request)
   */
  async getStatus(vin, refresh = false) {
    await this.connect();
    const vehicle = this._findVehicle(vin);
    try {
      return await vehicle.status({ refresh });
    } catch (err) {
      if (!refresh) {
        return vehicle.status({ refresh: true });
      }
      throw err;
    }
  }

  // ── commands ──────────────────────────────────────────────────────────

  async lock(vin) {
    await this.connect();
    return this._findVehicle(vin).lock();
  }

  async unlock(vin) {
    await this.connect();
    return this._findVehicle(vin).unlock();
  }

  /**
   * @param {string} vin
   * @param {object} [opts]
   * @param {number} [opts.temperature=22]  - Target cabin temperature in °C
   * @param {boolean} [opts.defrost=false]  - Enable front/rear defrost
   * @param {number}  [opts.heating=0]      - Seat heating level (0 = off)
   * @param {number}  [opts.duration=10]    - Engine-on duration in minutes
   */
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
