const http = require('http');
const https = require('https');
const URL = require('url');

const headers = {
    'accept': 'application/octet-stream',
    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/71.0.3578.98 Safari/537.36'
};

module.exports = function download(url, wstream, progress = () => {}, accepts = () => true) {
    return new Promise(function (resolve, reject) {
        let protocol = /^https:/.exec(url) ? https : http;

        const processRequest = (res) => {
            if (res.statusCode !== 200) {
                reject(`Server responded with the status code "${res.statusCode}" (remove?)`);
                return;
            }
            if (!accepts(res.headers['content-type'])) {
                reject(`Not acceptable type: "${res.headers['content-type']}" (remove?)`);
                return;
            }
            let total = parseInt(res.headers['content-length'], 10) || 0;
            let length = 0;
            res.pipe(wstream);
            res.on('data', (data) => {
                length += data.length;
                progress(length, total);
            });
            res.on('progress', progress);
            res.on('error', reject);
            res.on('end', resolve);
        };

        progress(0, 0);
        protocol
            .get(url, { headers }, (res1) => {
                protocol = /^https:/.exec(res1.headers.location) ? https : http;
                if (res1.headers.location) {
                    protocol
                        .get(res1.headers.location, { headers }, processRequest)
                        .on('error', reject);
                }
                else {
                    processRequest(res1);
                }
            })
            .on('error', reject);
    });
}