// Deploy Hunch to alwaysdata via SSH
const { Client } = require('ssh2');
const path = require('path');
const fs = require('fs');

const conn = new Client();

const SSH_HOST = 'ssh-hunch.alwaysdata.net';
const SSH_USER = 'hunch';
const SSH_PASS = 'Hunch2026Cloud!!';

conn.on('ready', () => {
  console.log('Connected to alwaysdata via SSH');

  const cloneCmd = `
    cd /home/hunch
    rm -rf admin www package-lock.json .npm 2>/dev/null
    git clone https://github.com/codecharmhq/hunch.git /tmp/hunch-code 2>&1
    cp -r /tmp/hunch-code/* /home/hunch/ 2>/dev/null
    cp /tmp/hunch-code/.gitignore /home/hunch/ 2>/dev/null
    mv /tmp/hunch-code/.git /home/hunch/ 2>/dev/null
    rm -rf /tmp/hunch-code
    echo "---GIT DONE---"
    cd /home/hunch && npm install --omit=dev --ignore-scripts 2>&1
    echo "---NPM DONE---"
    ls -la /home/hunch/
    echo "---DEPLOY COMPLETE---"
    echo "=== Restarting server ==="
    pkill -f "node server" 2>/dev/null
    sleep 2
    cd /home/hunch && nohup node server.js > server.log 2>&1 &
    sleep 3
    curl -s -o /dev/null -w "Main:%{http_code} Blog:%{http_code}\\n" http://localhost:8200/ http://localhost:8200/blog
  `;

  conn.exec(cloneCmd, (err, stream) => {
    if (err) throw err;
    let output = '';
    stream.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      process.stdout.write(chunk);
    });
    stream.stderr.on('data', (data) => {
      process.stderr.write(data);
    });
    stream.on('close', (code) => {
      console.log('SSH command finished with code:', code);
      console.log('\nDeployment complete!');
      console.log('Site should be live at: https://hunch.alwaysdata.net');
      conn.end();
    });
  });
});

conn.on('error', (err) => {
  console.error('SSH connection error:', err.message);
  process.exit(1);
});

conn.connect({
  host: SSH_HOST,
  port: 22,
  username: SSH_USER,
  password: SSH_PASS,
  readyTimeout: 15000
});
