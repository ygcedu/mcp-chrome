#!/usr/bin/env node

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import {
  tryRegisterUserLevelHost,
  colorText,
  registerWithElevatedPermissions,
  ensureExecutionPermissions,
} from './scripts/utils';

// 从 postinstall 导入 writeNodePath
async function writeNodePath(): Promise<void> {
  try {
    const nodePath = process.execPath;
    const nodePathFile = path.join(__dirname, 'node_path.txt');

    console.log(colorText(`正在写入 Node.js 路径: ${nodePath}`, 'blue'));
    fs.writeFileSync(nodePathFile, nodePath, 'utf8');
    console.log(colorText('✓ Node.js 路径已写入 run_host 脚本', 'green'));
  } catch (error: any) {
    console.warn(colorText(`⚠️ 写入 Node.js 路径失败: ${error.message}`, 'yellow'));
  }
}

program
  .version(require('../package.json').version)
  .description('Mcp Chrome 桥接 - 与 Chrome 扩展通信的本地服务');

// 注册 Native Messaging 主机
program
  .command('register')
  .description('注册 Native Messaging 主机')
  .option('-f, --force', '强制重新注册')
  .option('-s, --system', '使用系统级安装（需要管理员/sudo 权限）')
  .action(async (options) => {
    try {
      // 为 run_host 脚本写入 Node.js 路径
      await writeNodePath();

      // 检测是否以 root/管理员权限运行
      const isRoot = process.getuid && process.getuid() === 0; // Unix/Linux/Mac

      let isAdmin = false;
      if (process.platform === 'win32') {
        try {
          isAdmin = require('is-admin')(); // Windows 需要额外的包
        } catch (error) {
          console.warn(colorText('警告: 无法在 Windows 上检测管理员权限', 'yellow'));
          isAdmin = false;
        }
      }

      const hasElevatedPermissions = isRoot || isAdmin;

      // 如果指定了 --system 选项或以 root/管理员权限运行
      if (options.system || hasElevatedPermissions) {
        await registerWithElevatedPermissions();
        console.log(colorText('系统级 Native Messaging 主机注册成功！', 'green'));
        console.log(colorText('现在可以在 Chrome 扩展中使用 connectNative 连接到此服务。', 'blue'));
      } else {
        // 常规用户级安装
        console.log(colorText('正在注册用户级 Native Messaging 主机...', 'blue'));
        const success = await tryRegisterUserLevelHost();

        if (success) {
          console.log(colorText('Native Messaging 主机注册成功！', 'green'));
          console.log(
            colorText('现在可以在 Chrome 扩展中使用 connectNative 连接到此服务。', 'blue'),
          );
        } else {
          console.log(colorText('用户级注册失败，请尝试以下方法：', 'yellow'));
          console.log(colorText('  1. sudo mcp-chrome-bridge register', 'yellow'));
          console.log(colorText('  2. mcp-chrome-bridge register --system', 'yellow'));
          process.exit(1);
        }
      }
    } catch (error: any) {
      console.error(colorText(`注册失败: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

// 修复执行权限
program
  .command('fix-permissions')
  .description('修复 native host 文件的执行权限')
  .action(async () => {
    try {
      console.log(colorText('正在修复执行权限...', 'blue'));
      await ensureExecutionPermissions();
      console.log(colorText('✓ 执行权限修复成功！', 'green'));
    } catch (error: any) {
      console.error(colorText(`修复权限失败: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

// 更新 stdio-config.json 中的端口
program
  .command('update-port <port>')
  .description('更新 stdio-config.json 中的端口号')
  .action(async (port: string) => {
    try {
      const portNumber = parseInt(port, 10);
      if (isNaN(portNumber) || portNumber < 1 || portNumber > 65535) {
        console.error(colorText('错误: 端口必须是 1 到 65535 之间的有效数字', 'red'));
        process.exit(1);
      }

      const configPath = path.join(__dirname, 'mcp', 'stdio-config.json');

      if (!fs.existsSync(configPath)) {
        console.error(colorText(`错误: 在 ${configPath} 找不到配置文件`, 'red'));
        process.exit(1);
      }

      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);

      const currentUrl = new URL(config.url);
      currentUrl.port = portNumber.toString();
      config.url = currentUrl.toString();

      fs.writeFileSync(configPath, JSON.stringify(config, null, 4));

      console.log(colorText(`✓ 端口已成功更新为 ${portNumber}`, 'green'));
      console.log(colorText(`更新后的 URL: ${config.url}`, 'blue'));
    } catch (error: any) {
      console.error(colorText(`更新端口失败: ${error.message}`, 'red'));
      process.exit(1);
    }
  });

program.parse(process.argv);

// 如果没有提供命令，显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
