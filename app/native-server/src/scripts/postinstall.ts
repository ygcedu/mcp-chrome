#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { COMMAND_NAME } from './constant';
import { colorText, tryRegisterUserLevelHost } from './utils';

// 检查此脚本是否直接运行
const isDirectRun = require.main === module;

// 检测 npm 和 pnpm 的全局安装
function detectGlobalInstall(): boolean {
  // npm 使用 npm_config_global
  if (process.env.npm_config_global === 'true') {
    return true;
  }

  // pnpm 检测方法
  // 方法 1: 检查是否设置了 PNPM_HOME 且当前路径包含它
  if (process.env.PNPM_HOME && __dirname.includes(process.env.PNPM_HOME)) {
    return true;
  }

  // 方法 2: 检查我们是否在全局 pnpm 目录结构中
  // pnpm 全局包通常安装在 ~/.local/share/pnpm/global/5/node_modules
  // Windows: %APPDATA%\pnpm\global\5\node_modules
  const globalPnpmPatterns =
    process.platform === 'win32'
      ? ['\\pnpm\\global\\', '\\pnpm-global\\', '\\AppData\\Roaming\\pnpm\\']
      : ['/pnpm/global/', '/.local/share/pnpm/', '/pnpm-global/'];

  if (globalPnpmPatterns.some((pattern) => __dirname.includes(pattern))) {
    return true;
  }

  // 方法 3: 检查 pnpm 的 npm_config_prefix
  if (process.env.npm_config_prefix && __dirname.includes(process.env.npm_config_prefix)) {
    return true;
  }

  // 方法 4: Windows 特定的全局安装路径
  if (process.platform === 'win32') {
    const windowsGlobalPatterns = [
      '\\npm\\node_modules\\',
      '\\AppData\\Roaming\\npm\\node_modules\\',
      '\\Program Files\\nodejs\\node_modules\\',
      '\\nodejs\\node_modules\\',
    ];

    if (windowsGlobalPatterns.some((pattern) => __dirname.includes(pattern))) {
      return true;
    }
  }

  return false;
}

const isGlobalInstall = detectGlobalInstall();

/**
 * 为 run_host 脚本写入 Node.js 路径以避免脆弱的相对路径
 */
async function writeNodePath(): Promise<void> {
  try {
    const nodePath = process.execPath;
    const nodePathFile = path.join(__dirname, '..', 'node_path.txt');

    console.log(colorText(`正在写入 Node.js 路径: ${nodePath}`, 'blue'));
    fs.writeFileSync(nodePathFile, nodePath, 'utf8');
    console.log(colorText('✓ 已为 run_host 脚本写入 Node.js 路径', 'green'));
  } catch (error: any) {
    console.warn(colorText(`⚠️ 写入 Node.js 路径失败: ${error.message}`, 'yellow'));
  }
}

/**
 * 确保执行权限（无论是否为全局安装）
 */
async function ensureExecutionPermissions(): Promise<void> {
  if (process.platform === 'win32') {
    // Windows 平台处理
    await ensureWindowsFilePermissions();
    return;
  }

  // Unix/Linux 平台处理
  const filesToCheck = [
    path.join(__dirname, '..', 'index.js'),
    path.join(__dirname, '..', 'run_host.sh'),
    path.join(__dirname, '..', 'cli.js'),
  ];

  for (const filePath of filesToCheck) {
    if (fs.existsSync(filePath)) {
      try {
        fs.chmodSync(filePath, '755');
        console.log(colorText(`✓ 为 ${path.basename(filePath)} 设置执行权限`, 'green'));
      } catch (err: any) {
        console.warn(
          colorText(`⚠️ 无法为 ${path.basename(filePath)} 设置执行权限: ${err.message}`, 'yellow'),
        );
      }
    } else {
      console.warn(colorText(`⚠️ 文件未找到: ${filePath}`, 'yellow'));
    }
  }
}

/**
 * Windows 平台文件权限处理
 */
async function ensureWindowsFilePermissions(): Promise<void> {
  const filesToCheck = [
    path.join(__dirname, '..', 'index.js'),
    path.join(__dirname, '..', 'run_host.bat'),
    path.join(__dirname, '..', 'cli.js'),
  ];

  for (const filePath of filesToCheck) {
    if (fs.existsSync(filePath)) {
      try {
        // 检查文件是否为只读，如果是则移除只读属性
        const stats = fs.statSync(filePath);
        if (!(stats.mode & parseInt('200', 8))) {
          // 检查写权限
          // 尝试移除只读属性
          fs.chmodSync(filePath, stats.mode | parseInt('200', 8));
          console.log(colorText(`✓ 从 ${path.basename(filePath)} 移除只读属性`, 'green'));
        }

        // 验证文件可读性
        fs.accessSync(filePath, fs.constants.R_OK);
        console.log(colorText(`✓ 验证 ${path.basename(filePath)} 文件可访问性`, 'green'));
      } catch (err: any) {
        console.warn(
          colorText(`⚠️ 无法验证 ${path.basename(filePath)} 文件权限: ${err.message}`, 'yellow'),
        );
      }
    } else {
      console.warn(colorText(`⚠️ 文件未找到: ${filePath}`, 'yellow'));
    }
  }
}

async function tryRegisterNativeHost(): Promise<void> {
  try {
    console.log(colorText('尝试注册 Chrome Native Messaging 主机...', 'blue'));

    // 无论安装类型如何，始终确保执行权限
    await ensureExecutionPermissions();

    if (isGlobalInstall) {
      // 首先尝试用户级安装（不需要提升权限）
      const userLevelSuccess = await tryRegisterUserLevelHost();

      if (!userLevelSuccess) {
        // 用户级安装失败，建议使用注册命令
        console.log(colorText('用户级安装失败，可能需要系统级安装', 'yellow'));
        console.log(colorText('请运行以下命令进行系统级安装:', 'blue'));
        console.log(`  ${COMMAND_NAME} register --system`);
        printManualInstructions();
      }
    } else {
      // 本地安装模式，不尝试自动注册
      console.log(colorText('检测到本地安装，跳过自动注册', 'yellow'));
      printManualInstructions();
    }
  } catch (error) {
    console.log(
      colorText(
        `注册过程中出现错误: ${error instanceof Error ? error.message : String(error)}`,
        'red',
      ),
    );
    printManualInstructions();
  }
}

/**
 * 打印手动安装指南
 */
function printManualInstructions(): void {
  console.log('\n' + colorText('===== 手动注册指南 =====', 'blue'));

  console.log(colorText('1. 尝试用户级安装（推荐）:', 'yellow'));
  if (isGlobalInstall) {
    console.log(`  ${COMMAND_NAME} register`);
  } else {
    console.log(`  npx ${COMMAND_NAME} register`);
  }

  console.log(colorText('\n2. 如果用户级安装失败，尝试系统级安装:', 'yellow'));

  console.log(colorText('   使用 --system 参数（自动提升权限）:', 'yellow'));
  if (isGlobalInstall) {
    console.log(`  ${COMMAND_NAME} register --system`);
  } else {
    console.log(`  npx ${COMMAND_NAME} register --system`);
  }

  console.log(colorText('\n   或直接使用管理员权限:', 'yellow'));
  if (os.platform() === 'win32') {
    console.log(colorText('   请以管理员身份运行命令提示符或 PowerShell 并执行:', 'yellow'));
    if (isGlobalInstall) {
      console.log(`  ${COMMAND_NAME} register`);
    } else {
      console.log(`  npx ${COMMAND_NAME} register`);
    }
  } else {
    console.log(colorText('   请在终端中运行以下命令:', 'yellow'));
    if (isGlobalInstall) {
      console.log(`  sudo ${COMMAND_NAME} register`);
    } else {
      console.log(`  sudo npx ${COMMAND_NAME} register`);
    }
  }

  console.log('\n' + colorText('确保已安装 Chrome 扩展并刷新扩展以连接到本地服务。', 'blue'));
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  console.log(colorText(`正在安装 ${COMMAND_NAME}...`, 'green'));

  // 调试信息
  console.log(colorText('安装环境调试信息:', 'blue'));
  console.log(`  __dirname: ${__dirname}`);
  console.log(`  npm_config_global: ${process.env.npm_config_global}`);
  console.log(`  PNPM_HOME: ${process.env.PNPM_HOME}`);
  console.log(`  npm_config_prefix: ${process.env.npm_config_prefix}`);
  console.log(`  isGlobalInstall: ${isGlobalInstall}`);

  // 始终首先确保执行权限
  await ensureExecutionPermissions();

  // 为 run_host 脚本写入 Node.js 路径以供使用
  await writeNodePath();

  // 如果是全局安装，尝试自动注册
  if (isGlobalInstall) {
    await tryRegisterNativeHost();
  } else {
    console.log(colorText('检测到本地安装', 'yellow'));
    printManualInstructions();
  }
}

// 仅在直接运行此脚本时执行主函数
if (isDirectRun) {
  main().catch((error) => {
    console.error(
      colorText(`安装脚本错误: ${error instanceof Error ? error.message : String(error)}`, 'red'),
    );
  });
}
