'use strict';

import HistoryDatabase from './historyDatabase';
import LoggerManager from '../../logger';
import {openDB} from 'idb';

/**
 * Provides access to history database stored in a browser IndexedDB
 */
module.exports = class BrowserHistoryDatabase extends HistoryDatabase {

  /**
   * Constructs the class instance
   */
  constructor() {
    super();
    this._logger = LoggerManager.getLogger('BrowserHistoryDatabase');
  }

  /**
   * Returns history database instance
   * @returns {HistoryDatabase} history database instance
   */
  static getInstance() {
    if (!BrowserHistoryDatabase.instance) {
      BrowserHistoryDatabase.instance = new BrowserHistoryDatabase();
    }
    return BrowserHistoryDatabase.instance;
  }

  /**
   * Loads history from database
   * @param {string} accountId account id
   * @param {string} application application name
   * @return {Promise<{deals: Array<MetatraderDeal>, historyOrders: Array<MetatraderOrder>}>} full account history
   */
  async loadHistory(accountId, application) {
    let db;
    try {
      db = await this._getDatabase(accountId, application);
      let deals = await this._readDb(db, accountId + '-' + application + '-deals');
      deals.forEach(deal => deal.time = new Date(deal.time));
      let historyOrders = await this._readDb(db, accountId + '-' + application + '-historyOrders');
      historyOrders.forEach(historyOrder => {
        historyOrder.time = new Date(historyOrder.time);
        historyOrder.doneTime = new Date(historyOrder.doneTime);
      });
      return {deals, historyOrders};
    } catch (err) {
      this._logger.warn(`${accountId}: failed to read history database, will reinitialize it now`, err);
      await this.clear(accountId, application);
      return {deals: [], historyOrders: []};
    } finally {
      try {
        await db.close();
      } catch (err) {
        this._logger.error(`${accountId}: error closing db`, err);
      }
    }
  }

  /**
   * Removes history from database
   * @param {string} accountId account id
   * @param {string} application application name
   * @return {Promise} promise resolving when the history is removed
   */
  async clear(accountId, application) {
    let db;
    try {
      db = await this._getDatabase(accountId, application);
      await db.clear(accountId + '-' + application + '-deals');
      await db.clear(accountId + '-' + application + '-dealsIndex');
      await db.clear(accountId + '-' + application + '-historyOrders');
      await db.clear(accountId + '-' + application + '-historyOrdersIndex');
    } finally {
      try {
        await db.close();
      } catch (err) {
        this._logger.error(`${accountId}: error closing db`, err);
      }
    }
  }

  /**
   * Flushes the new history to db
   * @param {string} accountId account id
   * @param {string} application application name
   * @param {Array<MetatraderOrder>} newHistoryOrders history orders to save to db
   * @param {Array<MetatraderDeal>} newDeals deals to save to db
   * @return {Promise} promise resolving when the history is flushed
   */
  async flush(accountId, application, newHistoryOrders, newDeals) {
    let db;
    try {
      db = await this._getDatabase(accountId, application);
      await this._appendDb(db, accountId + '-' + application + '-deals', newDeals);
      await this._appendDb(db, accountId + '-' + application + '-historyOrders', newHistoryOrders);
    } finally {
      try {
        await db.close();
      } catch (err) {
        this._logger.error(`${accountId}: error closing db`, err);
      }
    }
  }

  async _getDatabase(accountId, application) {
    const keyPath = 'id';
    const db = await openDB('metaapi', 2, {
      upgrade(database, oldVersion, newVersion, transaction) {
        if (oldVersion !== 2) {
          if (database.objectStoreNames.contains('deals')) {
            database.deleteObjectStore('deals');
          }
          if (database.objectStoreNames.contains('historyOrders')) {
            database.deleteObjectStore('historyOrders');
          }
        }
        if (!database.objectStoreNames.contains(accountId + '-' + application + '-dealsIndex')) {
          database.createObjectStore(accountId + '-' + application + '-dealsIndex', {keyPath});
        }
        if (!database.objectStoreNames.contains(accountId + '-' + application + '-deals')) {
          database.createObjectStore(accountId + '-' + application + '-deals', {keyPath});
        }
        if (!database.objectStoreNames.contains(accountId + '-' + application + '-historyOrdersIndex')) {
          database.createObjectStore(accountId + '-' + application + '-historyOrdersIndex', {keyPath});
        }
        if (!database.objectStoreNames.contains(accountId + '-' + application + '-historyOrders')) {
          database.createObjectStore(accountId + '-' + application + '-historyOrders', {keyPath});
        }
      },
    });
    return db;
  }

  async _readDb(db, store) {
    const keys = await db.getAllKeys(store);
    let result = [];
    for (let key of keys) {
      let value = await db.get(store, key);
      if (value) {
        for (let line of value.data.split('\n')) {
          if (line.length) {
            let record = JSON.parse(line);
            result.push(record);
          }
        }
      }
    }
    return result;
  }

  async _appendDb(db, store, records) {
    if (records && records.length) {
      let lastKey = await db.get(store + 'Index', 'sn');
      let index = (lastKey || {index: 0}).index + 1;
      let data = records.map(r => JSON.stringify(r) + '\n').join('');
      await db.put(store, {data, id: '' + index});
      await db.put(store + 'Index', {id: 'sn', index});
    }
  }

};
