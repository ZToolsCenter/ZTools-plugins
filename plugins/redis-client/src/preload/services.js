const fs = require('node:fs')
const path = require('node:path')
const zlib = require('zlib')
const { ipcRenderer, webFrame, shell, nativeTheme } = require('electron')
const electronApi = require('electron')
const Redis = require('ioredis');
const { createTunnel } = require('tunnel-ssh');
const { writeCMD } = require('./commands.js');
const { sendCommand } = Redis.prototype;
const cmdProcess = require('child_process');

window.utools = {
  ...window.ztools
}

// redis command log
Redis.prototype.sendCommand = function (...options) {
  const command = options[0];

  // readonly mode
  if (this.options.connectionReadOnly && writeCMD[command.name.toUpperCase()]) {
    command.reject(new Error('You are in readonly mode! Unable to execute write command!'));
    return command.promise;
  }

  // exec directly, without logs
  if (this.withoutLogging === true) {
    // invalid in next calling
    this.withoutLogging = false;
    return sendCommand.apply(this, options);
  }

  const start = performance.now();
  const response = sendCommand.apply(this, options);
  const cost = performance.now() - start;

  const record = {
    time: new Date(), connectionName: this.options.connectionName, command, cost,
  };
  window.services.$bus.$emit('commandLog', record);

  return response;
};

// fix ioredis hgetall key has been toString()
Redis.Command.setReplyTransformer('hgetall', (result) => {
  const arr = [];
  for (let i = 0; i < result.length; i += 2) {
    arr.push([result[i], result[i + 1]]);
  }

  return arr;
});


// -------------------- window.services 注入 --------------------
window.services = {
  ipcRenderer: ipcRenderer,
  webFrame: webFrame,
  shell: shell,
  nativeTheme: nativeTheme,
  electron: electronApi,
  cmdProcess: cmdProcess,

  // ---------------- 文件读写 ----------------
  readFile(file) {
    return fs.readFileSync(file, { encoding: 'utf-8' })
  },

  readlineFile(file) {
    return require("readline").createInterface({
      input: require("fs").createReadStream(file),
    });
  },

  writeTextFile(text) {
    const filePath = path.join(window.utools.getPath('downloads'), Date.now() + '.txt')
    fs.writeFileSync(filePath, text, { encoding: 'utf-8' })
    return filePath
  },

  writeImageFile(base64Url) {
    const matchs = /^data:image\/([a-z]+);base64,/i.exec(base64Url)
    if (!matchs) return
    const filePath = path.join(window.utools.getPath('downloads'), Date.now() + '.' + matchs[1])
    fs.writeFileSync(filePath, base64Url.substring(matchs[0].length), { encoding: 'base64' })
    return filePath
  },

  // ---------------- 压缩/解压 ----------------
  unzip(buf) {
    try { return zlib.unzipSync(buf).toString() } catch { return false }
  },

  gzip(buf) {
    try { return zlib.gunzipSync(buf).toString() } catch { return false }
  },

  deflate(buf) {
    try { return zlib.inflateSync(buf).toString() } catch { return false }
  },

  deflateRaw(buf) {
    try { return zlib.inflateRawSync(buf).toString() } catch { return false }
  },

  brotli(buf) {
    try { return zlib.brotliDecompressSync(buf).toString() } catch { return false }
  },

  // ---------------- Msgpack ----------------
  isMsgpack: async (buf) => {
    try {
      const { decode } = await import('algo-msgpack-with-bigint')
      const result = decode(buf)
      return ['object', 'string'].includes(typeof result)
    } catch {
      return false
    }
  },

  // ---------------- Protobuf ----------------
  isProtobuf: async (buf) => {
    try {
      const { getData } = await import('rawproto')
      const result = getData(buf)
      if (result[0]) {
        const firstEle = Object.values(result[0])[0]
        if (firstEle < 1e-14 || firstEle.low) return false
      }
      return true
    } catch {
      return false
    }
  },

  showOpenDialog: async (options) => {
    return utools.showOpenDialog(options)
  },

  getAllFonts: () => {
    return require('font-list').getFonts();
  },


  // redisManager 核心工具
  redisManager: {
    async createConnection(host, port, auth, config, promise = true, forceStandalone = false, removeDb = false) {
      const options = this.getRedisOptions(host, port, auth, config);
      if (removeDb) delete options.db;

      let client;
      if (forceStandalone) client = new Redis(options);
      else if (config.sentinelOptions) client = new Redis(this.getSentinelOptions(host, port, auth, config));
      else if (config.cluster) client = new Redis.Cluster([{ host, port }], this.getClusterOptions(options, config.natMap || {}));
      else client = new Redis(options);

      if (promise) return Promise.resolve(client);
      return client;
    },

    async createSSHConnection(sshOptions, host, port, auth, config) {
      const sshOpts = this.getSSHOptions(sshOptions, host, port);
      const configRaw = JSON.parse(JSON.stringify(config));
      const sshConfigRaw = JSON.parse(JSON.stringify(sshOpts));

      try {
        const [server] = await createTunnel(...Object.values(sshOpts));
        const listenAddress = server.address();

        // sentinel mode
        if (configRaw.sentinelOptions) {
          const client = await this.createConnection(listenAddress.address, listenAddress.port, auth, configRaw, false, true, true);
          const reply = await client.call('sentinel', 'get-master-addr-by-name', configRaw.sentinelOptions.masterName);
          if (!reply) throw new Error(`Master name "${configRaw.sentinelOptions.masterName}" not exists!`);
          const tunnels = await this.createClusterSSHTunnels(sshConfigRaw, [{ host: reply[0], port: reply[1] }]);
          const sentinelClient = await this.createConnection(tunnels[0].localHost, tunnels[0].localPort, configRaw.sentinelOptions.nodePassword, configRaw, false, true);
          return sentinelClient;
        }

        // ssh cluster mode
        if (configRaw.cluster) {
          const client = await this.createConnection(listenAddress.address, listenAddress.port, auth, configRaw, false, true);
          const reply = await client.call('cluster', 'nodes');
          const nodes = this.getClusterNodes(reply);
          const tunnels = await this.createClusterSSHTunnels(sshConfigRaw, nodes);
          configRaw.natMap = this.initNatMap(tunnels);
          const clusterClient = await this.createConnection(tunnels[0].localHost, tunnels[0].localPort, auth, configRaw, false);
          return clusterClient;
        }

        // standalone
        return await this.createConnection(listenAddress.address, listenAddress.port, auth, configRaw, false);
      } catch (e) {
        ElMessage.error(`SSH error: ${e.message}`);
        eventBus.emit('closeConnection');
        throw e;
      }
    },

    getSSHOptions(options, host, port) {
      return {
        tunnelOptions: { autoClose: false },
        serverOptions: {},
        sshOptions: {
          host: options.host,
          port: options.port,
          username: options.username,
          password: options.password,
          privateKey: this.getFileContent(options.privatekey, options.privatekeybookmark),
          passphrase: options.passphrase || undefined,
          readyTimeout: options.timeout > 0 ? options.timeout * 1000 : 30000,
          keepaliveInterval: 10000,
        },
        forwardOptions: {
          dstAddr: host,
          dstPort: port,
        },
      };
    },

    getRedisOptions(host, port, auth, config) {
      return {
        host,
        port,
        family: 0,
        connectTimeout: 30000,
        retryStrategy: (times) => this.retryStragety(times, { host, port }),
        enableReadyCheck: false,
        connectionName: config.connectionName || null,
        password: auth,
        db: config.db ?? undefined,
        username: config.username ?? undefined,
        tls: config.sslOptions ? this.getTLSOptions(config.sslOptions) : undefined,
        connectionReadOnly: config.connectionReadOnly || undefined,
        stringNumbers: true,
      };
    },

    getSentinelOptions(host, port, auth, config) {
      return {
        sentinels: [{ host, port }],
        sentinelPassword: auth,
        password: config.sentinelOptions.nodePassword,
        name: config.sentinelOptions.masterName,
        connectTimeout: 30000,
        retryStrategy: (times) => this.retryStragety(times, { host, port }),
        enableReadyCheck: false,
        connectionName: config.connectionName || null,
        db: config.db ?? undefined,
        username: config.username ?? undefined,
        tls: config.sslOptions ? this.getTLSOptions(config.sslOptions) : undefined,
      };
    },

    getClusterOptions(redisOptions, natMap = {}) {
      return {
        connectionName: redisOptions.connectionName,
        enableReadyCheck: false,
        slotsRefreshTimeout: 30000,
        redisOptions,
        natMap,
      };
    },

    getClusterNodes(nodes, type = 'master') {
      const result = [];
      nodes = nodes.split('\n');
      for (let node of nodes) {
        if (!node) continue;
        node = node.trim().split(' ');
        if (node[2].includes(type)) {
          const dsn = node[1].split('@')[0];
          const lastIndex = dsn.lastIndexOf(':');
          const host = dsn.substr(0, lastIndex);
          const port = dsn.substr(lastIndex + 1);
          result.push({ host, port });
        }
      }
      return result;
    },

    async createClusterSSHTunnels(sshConfig, nodes) {
      const promises = nodes.map(async (node) => {
        const sshConfigCopy = JSON.parse(JSON.stringify(sshConfig));
        if (sshConfigCopy.sshOptions.privateKey) {
          sshConfigCopy.sshOptions.privateKey = Buffer.from(sshConfigCopy.sshOptions.privateKey);
        }
        sshConfigCopy.forwardOptions.dstHost = node.host;
        sshConfigCopy.forwardOptions.dstPort = node.port;
        const [server] = await createTunnel(...Object.values(sshConfigCopy));
        const addr = server.address();
        return {
          localHost: addr.address,
          localPort: addr.port,
          dstHost: node.host,
          dstPort: node.port,
        };
      });

      return Promise.all(promises);
    },

    initNatMap(tunnels) {
      const natMap = {};
      for (const line of tunnels) {
        natMap[`${line.dstHost}:${line.dstPort}`] = { host: line.localHost, port: line.localPort };
      }
      return natMap;
    },

    getTLSOptions(options) {
      return {
        ca: this.getFileContent(options.ca, options.cabookmark),
        key: this.getFileContent(options.key, options.keybookmark),
        cert: this.getFileContent(options.cert, options.certbookmark),
        servername: options.servername || undefined,
        checkServerIdentity: () => undefined,
        rejectUnauthorized: false,
      };
    },

    retryStragety(times, connection) {
      const maxRetryTimes = 3;
      if (times >= maxRetryTimes) {
        ElMessage.error('Too Many Attempts To Reconnect. Please Check The Server Status!');
        eventBus.emit('closeConnection');
        return false;
      }
      return Math.min(times * 200, 1000);
    },

    getFileContent(file, bookmark = '') {
      if (!file) return undefined;
      try {
        const content = window.services.readFile(file);
        return content;
      } catch (e) {
        ElMessage.error(`${t('message.key_no_permission')}\n[${e.message}]`);
        eventBus.emit('closeConnection');
        return undefined;
      }
    },
  }

}
