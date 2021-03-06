(function(exports) {
    const fs = require('fs');
    const path = require('path');
    const Definitions = require('./definitions');
    const Words = require('./words');
    const Sutta = require('./sutta');
    const SuttaCentralApi = require('./sutta-central-api');
    const Section = require('./section');
    const SectionParser = require('./section-parser');
    const PoParser = require('./po-parser');
    const SuttaCentralId = require('./sutta-central-id');
    const RE_ELLIPSIS = new RegExp(`${Words.U_ELLIPSIS}$`);
    const OPTS_EN = {
        prop: 'en',
    };
    const EXPANDABLE_SUTTAS = {
        mn1: true,
        mn41: true, 
        mn8: false, // very difficult to expand because of grammatical changes
        "sn12.23": true,
    };
    const SUPPORTED_TRANSLATORS = {
        sabbamitta: true,
        sujato: true,
        'sujato-walton': true,
        bodhi: true,
        horner: true,
        thanissaro: true,
        'caf_rhysdavids': true,
    };
    const SUPPORTED_LANGUAGES = {
        en: true,
        de: true,
    };

    class SuttaFactory { 
        constructor(opts={}) {
            this.type = this.constructor.name;
            this.lang = opts.lang || 'en';
            this.prop = opts.prop || this.lang;
            this.autoSection = !!opts.autoSection;
            this.reHeader = opts.reHeader || Sutta.RE_HEADER;
            this.suttaCentralApi = opts.suttaCentralApi;
            this.pootleParser = new PoParser();
            this.plainText = opts.plainText === true || opts.plainText == null;
        }

        static loadSutta(opts={}) {
            return new Promise((resolve, reject) => {
                (async function() { try {
                    var sf = await new SuttaFactory(opts).initialize();
                    var sutta = await sf.loadSutta(opts);
                    resolve(sutta);
                } catch(e) {reject(e);} })();
            });
        }

        static loadSuttaPootl(opts={}) {
            logger.warn(`loadSuttaPootl({opts}) is deprecated`);
            return new SuttaFactory(opts).loadSuttaPootl(opts);
        }

        initialize() {
            var that = this;
            return new Promise((resolve, reject) => {
                (async function() { try {
                    if (that.suttaCentralApi && that.suttaCentralApi.initialized == null) {
                        await that.suttaCentralApi.initialize();
                    }
                    resolve(that);
                } catch(e) {reject(e);} })();
            });
        }

        stripHtml(sutta) {
            var lang = this.lang;
            sutta.segments.forEach(seg => {
                var text = seg[lang];
                if (text.indexOf('<') >= 0) {
                    text = text.replace(/<\/li>/g,'\n');
                    seg[lang] = text.replace(/<[^>]+>/g,'');
                }
            });
            return sutta;
        }

        supportedSuttas(){
            var that = this;
            return new Promise((resolve, reject) => {
                (async function() { try {
                    var files = await that.pootleParser.files();
                    var suttas = {};
                    files.forEach(f => {
                        var flocal = f.split('/sc/')[1];
                        var ftokens = flocal.split('/');
                        var collection = ftokens[0];
                        suttas[collection] = suttas[collection] || [];
                        var fname = ftokens[ftokens.length - 1];
                        if (fname !== 'info.po') {
                            var sutta_uid = fname
                                .replace('.po','')
                                .replace(/([^0-9])0+/gum,'$1');
                            suttas[collection].push(sutta_uid);
                        }
                    });
                    resolve(suttas);
                } catch(e) {reject(e);} })();
            });
        }

        sectionSutta(sutta) {
            var lang = this.lang;
            var segStart = 0;
            var segments = sutta.segments;
            if (segments == null || segments.length === 0) {
                throw new Error('Sutta has no segments');
            }
            var group0 = new SuttaCentralId(segments[0].scid).groups[0];
            var newSections = segments.reduce((acc,seg,i) => {
                var scid = new SuttaCentralId(seg.scid);
                if (segStart === 0 && scid.groups[0] === group0) {
                    // don't split segment 0
                } else if (segStart === 0 && scid.groups[0] !== group0 || 
                    /^[1-9]/.test(seg[lang])) {
                    acc.push(new Section({
                        segments: segments.slice(segStart,i),
                    }));
                    segStart = i;
                }
                return acc;
            }, []);
            newSections.push(new Section({
                segments: segments.slice(segStart),
            }));
            if (newSections.length <= sutta.sections.length) {
                return sutta; // no sections
            }
            return new Sutta(Object.assign({}, sutta, {
                segments: null,
                sections: newSections,
            }));
        }

        loadSutta(opts={}) {
            var that = this;
            var language = opts.language || 'en';
            var autoSection = opts.autoSection == null ? this.autoSection : opts.autoSection;
            var plainText = opts.plainText == null ? this.plainText : opts.plainText;
            if (SUPPORTED_LANGUAGES[language] !== true) {
                return Promise.reject(
                    new Error(`SC-Voice does not support language: ${language}`));
            }
            var translator = opts.translator || 'sujato';
            if (SUPPORTED_TRANSLATORS[translator] !== true) {
                return Promise.reject(
                    new Error(`SC-Voice does not support translator: ${translator}`));
            }
 
            return new Promise((resolve, reject) => {
                (async function() { try {
                    var sutta = that.suttaCentralApi 
                        ? await that.suttaCentralApi.loadSutta(opts)
                        : await that.loadSuttaPootl(opts);
                    if (sutta == null) {
                        throw new Error(`loadSutta() not found opts:${JSON.stringify(opts)}`);
                    }
                    if (plainText) {
                        sutta = that.stripHtml(sutta);
                    }
                    if (opts.expand && EXPANDABLE_SUTTAS[sutta.sutta_uid]) {
                        sutta = that.expandSutta(that.parseSutta(sutta))
                    }
                    if (autoSection) {
                        sutta = that.sectionSutta(sutta);
                    }
                    resolve(sutta);
                } catch(e) {reject(e);} })();
            });
        }

        loadSuttaPootl(opts={}) {
            var that = this;
            return new Promise((resolve, reject) => {
                (async function() { try {
                    if (typeof opts === 'string') {
                        opts = {
                            id: opts,
                        }
                    }
                    var language = opts.language || 'en';
                    var translator = opts.translator || 'sujato';
                    var parser = that.pootleParser;
                    var id = opts.id || 'mn1';
                    var suttaPath = PoParser.suttaPath(id, opts.root);
                    var segments = await parser.parse(suttaPath, opts);
                    resolve(new Sutta(Object.assign({
                        sutta_uid: id,
                        support: Definitions.SUPPORT_LEVELS.Supported,
                        segments,
                        translation: {
                            lang: 'en',
                            author: 'Bhikku Sujato', // TODO: just guessing
                            author_uid: 'sujato', // TODO: just guessing
                        },
                    }, opts)));
                } catch(e) {reject(e);} })();
            });
        }

        parseSutta(sutta) {
            if (sutta.support && sutta.support.value === 'Legacy') {
                return sutta;
            }
            var segments = sutta.segments.slice();
            var parser = new SectionParser({
                prop: this.prop,
            });
            var sections = [];

            var header = [];
            while (Sutta.isHeader(segments[0])) {
                header.push(segments.shift());
            }
            if (header.length) {
                sections.push(new Section({
                    segments:header,
                }));
            }
            
            while (segments.length) {
                var section = parser.parseExpandableSection(segments);
                if (section == null) {
                    sections.push(new Section({
                        segments,
                    }));
                    break;
                } 
                var index = segments.indexOf(section.segments[0]);
                if (index) {
                    sections.push(new Section({
                        segments: segments.slice(0, index),
                    }));
                }
                sections.push(section);
                segments = segments.slice(index+section.segments.length);
            }
            return new Sutta(Object.assign({}, sutta, {
                sections,
            }));
        }

        expandSutta(sutta) {
            var parsedSutta = this.parseSutta(sutta);
            var sections = parsedSutta.sections.map(sect => {
                if (sect.expandable) {
                    return sect.expandAll();
                }
                return sect;
            });
            return new Sutta(Object.assign({}, sutta, {
                sections,
                prop: this.prop,
            }));
        }
    }

    module.exports = exports.SuttaFactory = SuttaFactory;
})(typeof exports === "object" ? exports : (exports = {}));

