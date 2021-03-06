#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
    logger,
} = require('rest-bundle');
const {
    Sutta,
    SuttaCentralApi,
    SuttaStore,
} = require('../index');


(async function() { try {
    var suttaCentralApi = await new SuttaCentralApi({
        apiUrl: 'http://staging.suttacentral.net/api',
    }).initialize();
    var store = await new SuttaStore({
        suttaCentralApi,
    }).initialize();
    var msStart = Date.now();
    var maxAge = 24*60*60;
    await store.updateSuttas(null, {
        maxAge,
    });
    logger.info(`elapsed:${((Date.now() - msStart)/1000).toFixed(1)}`);
} catch(e) {
    logger.error(e.stack);
    process.exit(-1);
}})();

