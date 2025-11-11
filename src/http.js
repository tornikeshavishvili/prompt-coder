// @ts-check
const http = require('http');
const https = require('https');
const CancelState = require('./cancelState');

function postJSONCancelable(urlStr, headers, bodyObj){
  return new Promise((resolve, reject)=>{
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const data = JSON.stringify(bodyObj||{});
      const opts = {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || (isHttps?443:80),
        path: u.pathname + (u.search || ''),
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...(headers||{}) }
      };
      const req = (isHttps?https:http).request(opts, res=>{
        const chunks = [];
        res.on('data', d=>chunks.push(d));
        res.on('end', ()=>{
          if (CancelState._cancelled || !CancelState.isRunning()) return resolve({ cancelled: true });
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode<200 || res.statusCode>=300) return reject(new Error(`HTTP ${res.statusCode}: ${text}`));
          try{ resolve(JSON.parse(text)); } catch{ resolve({ text }); }
        });
      });
      req.on('error', e=>{ if (CancelState._cancelled) return resolve({ cancelled: true }); else return reject(e); });
      CancelState.setRequest(req);
      CancelState.setRunning(true);
      req.write(data);
      req.end();
    } catch(err){ reject(err); }
  });
}

module.exports = { postJSONCancelable };
