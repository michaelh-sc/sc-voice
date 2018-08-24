(function(exports) {
    const fs = require('fs');
    const path = require('path');
    const Polly = require('./polly');
    const Words = require('./words');

    class Voice { 
        constructor(opts={}) {
            this.language = opts.language || 'en-IN';
            this.service = opts.service || 'aws-polly';
            this.name = opts.name || 'Raveena';
            this.rates = opts.rates || {
                navigation: Voice.RATE_FAST,
                recitation: Voice.RATE_SLOW,
            }
            this.gender = opts.gender || "female";
            this.usage = opts.usage || "recitation";
            this.ipa = opts.ipa || {};
            this.pitch = opts.pitch || "-0%";
            Object.defineProperty(this, '_services', {
                writable: true,
                value: opts.services || null,
            });
        }

        static get RATE_FAST() { return "+5%"; }
        static get RATE_SLOW() { return "-20%"; }

        static loadVoices(voicePath) {
            voicePath == null && (voicePath = path.join(__dirname, '../words/voices.json'));
            var json = JSON.parse(fs.readFileSync(voicePath).toString());
            return json.map(voice => new Voice(voice));
        }

        static createVoice(langOrName="en-GB", opts={}) {
            var voices = Voice.loadVoices();
            var voice = voices.filter(v => {
                return v.language === langOrName || v.name === langOrName;
            })[0];
            var ipa = voice.ipa;
            if (ipa == null) {
                var words = new Words();
                ipa = words.ipa;
            }
            voice = Object.assign({
                ipa,
            }, voice, opts);
            return new Voice(voice);
        }

        get services() {
            if (this._services == null) {
                var words = new Words();
                this._services = {};
                Object.keys(this.rates).forEach(key => {
                    if (this.service === 'aws-polly') {
                        this._services[key] = new Polly({
                            words,
                            voice: this.name,
                            prosody: {
                                rate: this.rates[key],
                                pitch: this.pitch,
                            }
                        });
                    } else {
                        throw new Error(`unknown service:${this.service}`);
                    }
                });

            }
            return this._services;
        }

        speak(text, opts={}) {
            var usage = opts.usage || this.usage;
            var service = this.services[usage];
            return new Promise((resolve, reject) => {
                (async function() { try {
                    var result = await service.synthesizeText(text, opts);
                    resolve(result);
                } catch(e) {reject(e);} })();
            });
        }

    }

    module.exports = exports.Voice = Voice;
})(typeof exports === "object" ? exports : (exports = {}));
