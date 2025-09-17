import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { promisify } from 'util';
import { COMMAND_NAME, DESCRIPTION, EXTENSION_ID, HOST_NAME } from './constant';

export const access = promisify(fs.access);
export const mkdir = promisify(fs.mkdir);
export const writeFile = promisify(fs.writeFile);

/**
 * 打印彩色文本
 */
export function colorText(text: string, color: string): string {
  const colors: Record<string, string> = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
  };

  return colors[color] + text + colors.reset;
}

/**
 * 获取用户级清单文件路径
 */
export function getUserManifestPath(): string {
  if (os.platform() === 'win32') {
    // Windows: %APPDATA%\Google\Chrome\NativeMessagingHosts\
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'Google',
      'Chrome',
      'NativeMessagingHosts',
      `${HOST_NAME}.json`,
    );
  } else if (os.platform() === 'darwin') {
    // macOS: ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Google',
      'Chrome',
      'NativeMessagingHosts',
      `${HOST_NAME}.json`,
    );
  } else {
    // Linux: ~/.config/google-chrome/NativeMessagingHosts/
    return path.join(
      os.homedir(),
      '.config',
      'google-chrome',
      'NativeMessagingHosts',
      `${HOST_NAME}.json`,
    );
  }
}

/**
 * 获取系统级清单文件路径
 */
export function getSystemManifestPath(): string {
  if (os.platform() === 'win32') {
    // Windows: %ProgramFiles%\Google\Chrome\NativeMessagingHosts\
    return path.join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'Google',
      'Chrome',
      'NativeMessagingHosts',
      `${HOST_NAME}.json`,
    );
  } else if (os.platform() === 'darwin') {
    // macOS: /Library/Google/Chrome/NativeMessagingHosts/
    return path.join('/Library', 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
  } else {
    // Linux: /etc/opt/chrome/native-messaging-hosts/
    return path.join('/etc', 'opt', 'chrome', 'native-messaging-hosts', `${HOST_NAME}.json`);
  }
}

/**
 * 获取原生主机启动脚本文件路径
 */
export async function getMainPath(): Promise<string> {
  try {
    const packageDistDir = path.join(__dirname, '..');
    const wrapperScriptName = process.platform === 'win32' ? 'run_host.bat' : 'run_host.sh';
    const absoluteWrapperPath = path.resolve(packageDistDir, wrapperScriptName);
    return absoluteWrapperPath;
  } catch (error) {
    console.log(colorText('无法找到全局包路径，使用当前目录', 'yellow'));
    throw error;
  }
}

/**
 * 确保关键文件具有执行权限
 */
export async function ensureExecutionPermissions(): Promise<void> {
  try {
    const packageDistDir = path.join(__dirname, '..');

    if (process.platform === 'win32') {
      // Windows 平台处理
      await ensureWindowsFilePermissions(packageDistDir);
      return;
    }

    // Unix/Linux 平台处理
    const filesToCheck = [
      path.join(packageDistDir, 'index.js'),
      path.join(packageDistDir, 'run_host.sh'),
      path.join(packageDistDir, 'cli.js'),
    ];

    for (const filePath of filesToCheck) {
      if (fs.existsSync(filePath)) {
        try {
          fs.chmodSync(filePath, '755');
          console.log(colorText(`✓ 为 ${path.basename(filePath)} 设置执行权限`, 'green'));
        } catch (err: any) {
          console.warn(
            colorText(
              `⚠️ 无法为 ${path.basename(filePath)} 设置执行权限: ${err.message}`,
              'yellow',
            ),
          );
        }
      } else {
        console.warn(colorText(`⚠️ 文件未找到: ${filePath}`, 'yellow'));
      }
    }
  } catch (error: any) {
    console.warn(colorText(`⚠️ 确保执行权限时出错: ${error.message}`, 'yellow'));
  }
}

/**
 * Windows 平台文件权限处理
 */
async function ensureWindowsFilePermissions(packageDistDir: string): Promise<void> {
  const filesToCheck = [
    path.join(packageDistDir, 'index.js'),
    path.join(packageDistDir, 'run_host.bat'),
    path.join(packageDistDir, 'cli.js'),
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

/**
 * 创建 Native Messaging 主机清单内容
 */
export async function createManifestContent(): Promise<any> {
  const mainPath = await getMainPath();

  return {
    name: HOST_NAME,
    description: DESCRIPTION,
    path: mainPath, // Node.js可执行文件路径
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  };
}

/**
 * 验证Windows注册表项是否存在
 */
function verifyWindowsRegistryEntry(registryKey: string, expectedPath: string): boolean {
  if (os.platform() !== 'win32') {
    return true; // 非Windows平台跳过验证
  }

  try {
    const result = execSync(`reg query "${registryKey}" /ve`, { encoding: 'utf8', stdio: 'pipe' });
    const lines = result.split('\n');
    for (const line of lines) {
      if (line.includes('REG_SZ') && line.includes(expectedPath.replace(/\\/g, '\\\\'))) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * 尝试注册用户级别的Native Messaging主机
 */
export async function tryRegisterUserLevelHost(): Promise<boolean> {
  try {
    console.log(colorText('尝试注册用户级 Native Messaging 主机...', 'blue'));

    // 1. 确保执行权限
    await ensureExecutionPermissions();

    // 2. 确定清单文件路径
    const manifestPath = getUserManifestPath();

    // 3. 确保目录存在
    await mkdir(path.dirname(manifestPath), { recursive: true });

    // 4. 创建清单内容
    const manifest = await createManifestContent();

    console.log('manifest path==>', manifest, manifestPath);

    // 5. 写入清单文件
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    if (os.platform() === 'win32') {
      const registryKey = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
      try {
        // 确保路径使用正确的转义格式
        const escapedPath = manifestPath.replace(/\\/g, '\\\\');
        const regCommand = `reg add "${registryKey}" /ve /t REG_SZ /d "${escapedPath}" /f`;

        console.log(colorText(`执行注册表命令: ${regCommand}`, 'blue'));
        execSync(regCommand, { stdio: 'pipe' });

        // 验证注册表项是否创建成功
        if (verifyWindowsRegistryEntry(registryKey, manifestPath)) {
          console.log(colorText('✓ 成功创建 Windows 注册表项', 'green'));
        } else {
          console.log(colorText('⚠️ 注册表项已创建但验证失败', 'yellow'));
        }
      } catch (error: any) {
        console.log(colorText(`⚠️ 无法创建 Windows 注册表项: ${error.message}`, 'yellow'));
        console.log(colorText(`注册表键: ${registryKey}`, 'yellow'));
        console.log(colorText(`清单路径: ${manifestPath}`, 'yellow'));
        return false; // Windows上如果注册表项创建失败，整个注册过程应该视为失败
      }
    }

    console.log(colorText('成功注册用户级 Native Messaging 主机!', 'green'));
    return true;
  } catch (error) {
    console.log(
      colorText(
        `用户级注册失败: ${error instanceof Error ? error.message : String(error)}`,
        'yellow',
      ),
    );
    return false;
  }
}

// 导入is-admin包（仅在Windows平台使用）
let isAdmin: () => boolean = () => false;
if (process.platform === 'win32') {
  try {
    isAdmin = require('is-admin');
  } catch (error) {
    console.warn('缺少is-admin依赖，Windows平台下可能无法正确检测管理员权限');
    console.warn(error);
  }
}

/**
 * 使用提升权限注册系统级清单
 */
export async function registerWithElevatedPermissions(): Promise<void> {
  try {
    console.log(colorText('尝试注册系统级清单...', 'blue'));

    // 1. 确保执行权限
    await ensureExecutionPermissions();

    // 2. 准备清单内容
    const manifest = await createManifestContent();

    // 3. 获取系统级清单路径
    const manifestPath = getSystemManifestPath();

    // 4. 创建临时清单文件
    const tempManifestPath = path.join(os.tmpdir(), `${HOST_NAME}.json`);
    await writeFile(tempManifestPath, JSON.stringify(manifest, null, 2));

    // 5. 检测是否已经有管理员权限
    const isRoot = process.getuid && process.getuid() === 0; // Unix/Linux/Mac
    const hasAdminRights = process.platform === 'win32' ? isAdmin() : false; // Windows平台检测管理员权限
    const hasElevatedPermissions = isRoot || hasAdminRights;

    // 准备命令
    const command =
      os.platform() === 'win32'
        ? `if not exist "${path.dirname(manifestPath)}" mkdir "${path.dirname(manifestPath)}" && copy "${tempManifestPath}" "${manifestPath}"`
        : `mkdir -p "${path.dirname(manifestPath)}" && cp "${tempManifestPath}" "${manifestPath}" && chmod 644 "${manifestPath}"`;

    if (hasElevatedPermissions) {
      // 已经有管理员权限，直接执行命令
      try {
        // 创建目录
        if (!fs.existsSync(path.dirname(manifestPath))) {
          fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
        }

        // 复制文件
        fs.copyFileSync(tempManifestPath, manifestPath);

        // 设置权限（非Windows平台）
        if (os.platform() !== 'win32') {
          fs.chmodSync(manifestPath, '644');
        }

        console.log(colorText('系统级清单注册成功!', 'green'));
      } catch (error: any) {
        console.error(colorText(`系统级清单安装失败: ${error.message}`, 'red'));
        throw error;
      }
    } else {
      // 没有管理员权限，打印手动操作提示
      console.log(colorText('⚠️ 系统级安装需要管理员权限', 'yellow'));
      console.log(colorText('请使用管理员权限运行以下命令之一:', 'blue'));

      if (os.platform() === 'win32') {
        console.log(colorText('  1. 以管理员身份打开命令提示符并运行:', 'blue'));
        console.log(colorText(`     ${command}`, 'cyan'));
      } else {
        console.log(colorText('  1. 使用 sudo 运行:', 'blue'));
        console.log(colorText(`     sudo ${command}`, 'cyan'));
      }

      console.log(colorText('  2. 或使用提升权限运行注册命令:', 'blue'));
      console.log(colorText(`     sudo ${COMMAND_NAME} register --system`, 'cyan'));

      throw new Error('系统级安装需要管理员权限');
    }

    // 6. Windows特殊处理 - 设置系统级注册表
    if (os.platform() === 'win32') {
      const registryKey = `HKLM\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
      // 确保路径使用正确的转义格式
      const escapedPath = manifestPath.replace(/\\/g, '\\\\');
      const regCommand = `reg add "${registryKey}" /ve /t REG_SZ /d "${escapedPath}" /f`;

      console.log(colorText(`创建系统注册表项: ${registryKey}`, 'blue'));
      console.log(colorText(`清单路径: ${manifestPath}`, 'blue'));

      if (hasElevatedPermissions) {
        // 已经有管理员权限，直接执行注册表命令
        try {
          execSync(regCommand, { stdio: 'pipe' });

          // 验证注册表项是否创建成功
          if (verifyWindowsRegistryEntry(registryKey, manifestPath)) {
            console.log(colorText('Windows 注册表项创建成功!', 'green'));
          } else {
            console.log(colorText('⚠️ 注册表项已创建但验证失败', 'yellow'));
          }
        } catch (error: any) {
          console.error(colorText(`Windows 注册表项创建失败: ${error.message}`, 'red'));
          console.error(colorText(`命令: ${regCommand}`, 'red'));
          throw error;
        }
      } else {
        // 没有管理员权限，打印手动操作提示
        console.log(colorText('⚠️ Windows 注册表修改需要管理员权限', 'yellow'));
        console.log(colorText('请以管理员身份运行以下命令:', 'blue'));
        console.log(colorText(`  ${regCommand}`, 'cyan'));
        console.log(colorText('或使用提升权限运行注册命令:', 'blue'));
        console.log(
          colorText(
            `  以管理员身份运行命令提示符并执行: ${COMMAND_NAME} register --system`,
            'cyan',
          ),
        );

        throw new Error('Windows 注册表修改需要管理员权限');
      }
    }
  } catch (error: any) {
    console.error(colorText(`注册失败: ${error.message}`, 'red'));
    throw error;
  }
}
