// LYRICAL Runtime Bridge for WhatsApp Multi-Device Bots
// 1. Intercepts EADDRINUSE port collisions (e.g. hardcoded port 8080/3000 in bot scripts) and rebinds to a free port
// 2. Intercepts blocked MEGA.nz session downloads (EBLOCKED -16)
// 3. Bridges Baileys QR / Pairing Code events to LYRICAL console logs
const net = require('net');
const Module = require('module');

// --- 1. PORT COLLISION & EADDRINUSE GUARD ---
const originalListen = net.Server.prototype.listen;

function isReservedPort(portNum) {
  // Ports 3000 and 8080 are used by the LYRICAL platform and Cloud Run container proxy
  return portNum === 3000 || portNum === 8080;
}

net.Server.prototype.listen = function (...args) {
  const server = this;

  // Attach automatic EADDRINUSE recovery listener if not already attached
  if (!server.__lyricalPortGuardAttached) {
    Object.defineProperty(server, '__lyricalPortGuardAttached', {
      value: true,
      enumerable: false,
    });

    server.on('error', (err) => {
      if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
        const busyPort = err.port || '8080';
        console.log(
          `[LYRICAL-PORT-GUARD] Port ${busyPort} is already in use; automatically rebinding bot HTTP server to an available dynamic port...`
        );
        setTimeout(() => {
          try {
            originalListen.call(server, 0, '0.0.0.0');
          } catch {
            // ignore fallback error
          }
        }, 50);
      }
    });
  }

  // Rewrite hardcoded reserved ports (8080 / 3000) to LYRICAL_BOT_PORT or ephemeral port 0
  const preferredPort = Number(process.env.LYRICAL_BOT_PORT) || 0;

  if (args.length > 0) {
    const first = args[0];
    if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
      const requestedPort = Number(first);
      if (isReservedPort(requestedPort)) {
        args[0] = preferredPort;
        console.log(
          `[LYRICAL-PORT-GUARD] Redirected bot HTTP server from reserved port ${requestedPort} to assigned container port ${
            preferredPort || 'auto'
          }`
        );
      }
    } else if (first && typeof first === 'object' && typeof first.port === 'number') {
      if (isReservedPort(first.port)) {
        args[0] = { ...first, port: preferredPort };
        console.log(
          `[LYRICAL-PORT-GUARD] Redirected bot HTTP server from reserved port ${first.port} to assigned container port ${
            preferredPort || 'auto'
          }`
        );
      }
    }
  }

  return originalListen.apply(this, args);
};

// --- 2. MODULE REQUIRE INTERCEPTORS (MEGAJS & BAILEYS) ---
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  const loaded = originalRequire.apply(this, arguments);
  try {
    if (!loaded || typeof loaded !== 'object') {
      return loaded;
    }

    // Guard megajs against unhandled EBLOCKED (-16) or expired default session links
    if (id === 'megajs' && loaded.File && typeof loaded.File.fromURL === 'function') {
      const origFromURL = loaded.File.fromURL.bind(loaded.File);
      loaded.File.fromURL = function (url) {
        const fileInstance = origFromURL(url);
        if (fileInstance && typeof fileInstance.download === 'function') {
          const origDownload = fileInstance.download.bind(fileInstance);
          fileInstance.download = function (cb) {
            if (typeof cb === 'function') {
              return origDownload((err, data) => {
                if (err) {
                  console.log(
                    `[LYRICAL-SESSION-GUARD] MEGA session download skipped (${
                      err.message || err
                    }). Falling back to direct WhatsApp Pairing Code / QR authentication.`
                  );
                  return;
                }
                cb(null, data);
              });
            }
            return origDownload.apply(this, arguments);
          };
        }
        return fileInstance;
      };
    }

    // Hook @whiskeysockets/baileys or @adiwajshing/baileys to emit live QR and Pairing Codes
    if (
      (id === '@whiskeysockets/baileys' || id === '@adiwajshing/baileys' || id === 'baileys') &&
      Object.isExtensible(loaded) &&
      !Object.isFrozen(loaded)
    ) {
      const wrapMakeWASocket = (origFn) => {
        return function () {
          const sock = origFn.apply(this, arguments);
          try {
            const authMethod = process.env.WHATSAPP_AUTH_METHOD || 'pairing_code';
            const rawPhone = (process.env.WHATSAPP_PHONE || '').replace(/[^0-9]/g, '');
            let pairingRequested = false;

            if (sock && sock.ev && typeof sock.ev.on === 'function') {
              sock.ev.on('connection.update', async (update) => {
                const { connection, qr } = update || {};

                if (qr) {
                  console.log('QR_CODE_DATA:' + qr);

                  if (
                    authMethod === 'pairing_code' &&
                    rawPhone.length >= 7 &&
                    !pairingRequested &&
                    typeof sock.requestPairingCode === 'function'
                  ) {
                    pairingRequested = true;
                    try {
                      const code = await sock.requestPairingCode(rawPhone);
                      const formatted =
                        code && code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
                      console.log(`PAIRING CODE: ${formatted}`);
                    } catch (pairErr) {
                      console.log(
                        `[WHATSAPP-PAIR-WARN] Could not request pairing code: ${pairErr.message}`
                      );
                    }
                  }
                }

                if (connection === 'open') {
                  console.log('WhatsApp Connected! Session established.');
                }
              });
            }
          } catch {
            // ignore bridge hook error
          }
          return sock;
        };
      };

      if (typeof loaded.default === 'function' && !loaded.__lyricalWrapped) {
        const wrapped = wrapMakeWASocket(loaded.default);
        try {
          Object.assign(wrapped, loaded.default);
          loaded.default = wrapped;
          if (typeof loaded.makeWASocket === 'function') {
            loaded.makeWASocket = wrapped;
          }
          Object.defineProperty(loaded, '__lyricalWrapped', { value: true });
        } catch {
          // ignore mutation errors on read-only modules
        }
      }
    }
  } catch {
    // Never allow hook failure to crash host process or loader
  }

  return loaded;
};
