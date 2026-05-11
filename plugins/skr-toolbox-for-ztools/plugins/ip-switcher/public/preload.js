const os = require('os');
const { exec } = require('./sudoPrompt');

const cmd = (cmdStr) => {
  return new Promise((resolve, reject) => {
    exec(cmdStr, (error, stdout, stderr) => {
      if (error) {
        reject({ error, data: stdout });
      } else if (stderr) {
        reject({ error: stderr, data: stdout });
      } else {
        resolve({ data: stdout });
      }
    });
  });
};

const prefix = 'netsh interface ip';

const getDnsCommands = (name, dns = 'none', dns2 = '') => {
  if (dns === 'none') {
    return [`${prefix} set dns name="${name}" source=dhcp`];
  }

  const commands = [`${prefix} set dns name="${name}" static ${dns}`];
  if (dns2 && dns2 !== 'none') {
    commands.push(`${prefix} add dns name="${name}" ${dns2} index=2`);
  }

  return commands;
};

window.netshSetAddress = (name, address, netmask, gateway = 'none', dns = 'none', dns2 = '') => {
  const commands = [];

  if (address && netmask) {
    const gwmetric = gateway !== 'none' ? 1 : '';
    commands.push(
      `${prefix} set address name="${name}" static ${address} ${netmask} ${gateway} ${gwmetric}`.trim(),
    );
  }

  commands.push(...getDnsCommands(name, dns, dns2));
  return cmd(commands.join(' && '));
};

window.netshSetAddressDhcp = (name) => {
  const a = `${prefix} set address name="${name}" source=dhcp`;
  const b = `${prefix} set dns name="${name}" source=dhcp`;
  return cmd(`${a} && ${b}`);
};

window.netshShowAddress = () => cmd('netsh interface ip show address');

window.networkInterfaces = () => os.networkInterfaces();
