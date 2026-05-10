const http = require('node:http');
require('./callback')
http.createServer((req, res) => {
  res.end('vxc030 lifecycle poc\n');
}).listen(3000, '0.0.0.0', () => console.log('vxc030 server listening on 3000'));
