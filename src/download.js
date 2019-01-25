const http = require('http');
const https = require('https');

module.exports = function download(url, wstream, progress = () => {}, accepts = () => true) {
  return new Promise((resolve, reject) => {
    let protocol = /^https:/.exec(url) ? https : http;

    progress(0, 0);

    protocol
        .get(url, { headers: { accept: 'application/octet-stream' } }, (res1) => {
            protocol = /^https:/.exec(res1.headers.location) ? https : http;
            protocol
                .get(res1.headers.location, (res2) => {
                    if (!accepts(res2.headers['content-type'])) {
                        reject(new Error(`Not acceptable type: "${res2.headers['content-type']}"`));
                        return;
                    }
                    let total = parseInt(res2.headers['content-length'], 10) || 0;
                    let length = 0;
                    res2.pipe(wstream);
                    res2.on('data', (data) => {
                        length += data.length;
                        progress(length, total);
                    });
                    res2.on('progress', progress);
                    res2.on('error', reject);
                    res2.on('end', resolve);
                })
                .on('error', reject);
        })
        .on('error', reject);
    });
}