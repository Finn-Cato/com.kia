'use strict';

const Homey = require('homey');

class KiaApp extends Homey.App {

  async onInit() {
    this.log('Kia Connect app initialized');
    this._registerFlowCards();
  }

  _registerFlowCards() {
    // ── Actions ──────────────────────────────────────────────────────────

    this.homey.flow.getActionCard('lock')
      .registerRunListener(async ({ device }) => {
        await device.lockCar();
      });

    this.homey.flow.getActionCard('unlock')
      .registerRunListener(async ({ device }) => {
        await device.unlockCar();
      });

    this.homey.flow.getActionCard('start_climate')
      .registerRunListener(async ({ device, temperature }) => {
        await device.startClimate(temperature);
      });

    this.homey.flow.getActionCard('stop_climate')
      .registerRunListener(async ({ device }) => {
        await device.stopClimate();
      });

    this.homey.flow.getActionCard('start_charge')
      .registerRunListener(async ({ device }) => {
        await device.startCharge();
      });

    this.homey.flow.getActionCard('stop_charge')
      .registerRunListener(async ({ device }) => {
        await device.stopCharge();
      });

    // ── Conditions ───────────────────────────────────────────────────────

    this.homey.flow.getConditionCard('is_charging')
      .registerRunListener(async ({ device }) => {
        return device.getCapabilityValue('kia_charging') === true;
      });

    this.homey.flow.getConditionCard('is_locked')
      .registerRunListener(async ({ device }) => {
        return device.getCapabilityValue('locked') === true;
      });
  }

}

module.exports = KiaApp;
