#!/usr/bin/env bash

# 配置
ENABLE_LOG_ROTATION="true"
LOG_RETENTION_COUNT=5

# 设置路径
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
mkdir -p "${LOG_DIR}"

# 日志轮转
if [ "${ENABLE_LOG_ROTATION}" = "true" ]; then
    ls -tp "${LOG_DIR}/native_host_wrapper_macos_"* 2>/dev/null | tail -n +$((LOG_RETENTION_COUNT + 1)) | xargs -I {} rm -- {}
    ls -tp "${LOG_DIR}/native_host_stderr_macos_"* 2>/dev/null | tail -n +$((LOG_RETENTION_COUNT + 1)) | xargs -I {} rm -- {}
fi

# 日志设置
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
WRAPPER_LOG="${LOG_DIR}/native_host_wrapper_macos_${TIMESTAMP}.log"
STDERR_LOG="${LOG_DIR}/native_host_stderr_macos_${TIMESTAMP}.log"
NODE_SCRIPT="${SCRIPT_DIR}/index.js"

# 初始日志记录
{
    echo "--- 包装脚本在 $(date) 被调用 ---"
    echo "SCRIPT_DIR: ${SCRIPT_DIR}"
    echo "LOG_DIR: ${LOG_DIR}"
    echo "NODE_SCRIPT: ${NODE_SCRIPT}"
    echo "Initial PATH: ${PATH}"
    echo "用户: $(whoami)"
    echo "当前工作目录: $(pwd)"
} > "${WRAPPER_LOG}"

# Node.js 发现
NODE_EXEC=""

# 优先级 1: 安装时的 node 路径
NODE_PATH_FILE="${SCRIPT_DIR}/node_path.txt"
echo "正在搜索 Node.js..." >> "${WRAPPER_LOG}"
echo "[优先级 1] 检查安装时的 node 路径" >> "${WRAPPER_LOG}"
if [ -f "${NODE_PATH_FILE}" ]; then
    EXPECTED_NODE=$(cat "${NODE_PATH_FILE}" 2>/dev/null | tr -d '\n\r')
    if [ -n "${EXPECTED_NODE}" ] && [ -x "${EXPECTED_NODE}" ]; then
        NODE_EXEC="${EXPECTED_NODE}"
        echo "在 ${NODE_EXEC} 找到安装时的 node" >> "${WRAPPER_LOG}"
    fi
fi

# 优先级 1.5: 回退到相对路径
if [ -z "${NODE_EXEC}" ]; then
    EXPECTED_NODE="${SCRIPT_DIR}/../../../bin/node"
    echo "[优先级 1.5] 检查相对路径" >> "${WRAPPER_LOG}"
    if [ -x "${EXPECTED_NODE}" ]; then
        NODE_EXEC="${EXPECTED_NODE}"
        echo "在相对路径找到 node: ${NODE_EXEC}" >> "${WRAPPER_LOG}"
    fi
fi

# 优先级 2: NVM
if [ -z "${NODE_EXEC}" ]; then
    echo "[优先级 2] 检查 NVM" >> "${WRAPPER_LOG}"
    NVM_DIR="$HOME/.nvm"
    if [ -d "${NVM_DIR}" ]; then
        # 首先尝试默认版本
        if [ -L "${NVM_DIR}/alias/default" ]; then
            NVM_DEFAULT_VERSION=$(readlink "${NVM_DIR}/alias/default")
            NVM_DEFAULT_NODE="${NVM_DIR}/versions/node/${NVM_DEFAULT_VERSION}/bin/node"
            if [ -x "${NVM_DEFAULT_NODE}" ]; then
                NODE_EXEC="${NVM_DEFAULT_NODE}"
                echo "找到 NVM 默认 node: ${NODE_EXEC}" >> "${WRAPPER_LOG}"
            fi
        fi

        # 回退到最新版本
        if [ -z "${NODE_EXEC}" ]; then
            LATEST_NVM_VERSION_PATH=$(ls -d ${NVM_DIR}/versions/node/v* 2>/dev/null | sort -V | tail -n 1)
            if [ -n "${LATEST_NVM_VERSION_PATH}" ] && [ -x "${LATEST_NVM_VERSION_PATH}/bin/node" ]; then
                NODE_EXEC="${LATEST_NVM_VERSION_PATH}/bin/node"
                echo "找到 NVM 最新 node: ${NODE_EXEC}" >> "${WRAPPER_LOG}"
            fi
        fi
    fi
fi

# 优先级 3: 常见路径
if [ -z "${NODE_EXEC}" ]; then
    echo "[优先级 3] 检查常见路径" >> "${WRAPPER_LOG}"
    COMMON_NODE_PATHS=(
        "/opt/homebrew/bin/node"
        "/usr/local/bin/node"
    )
    for path_to_node in "${COMMON_NODE_PATHS[@]}"; do
        if [ -x "${path_to_node}" ]; then
            NODE_EXEC="${path_to_node}"
            echo "在 ${NODE_EXEC} 找到 node" >> "${WRAPPER_LOG}"
            break
        fi
    done
fi

# 优先级 4: command -v
if [ -z "${NODE_EXEC}" ]; then
    echo "[优先级 4] 尝试 'command -v node'" >> "${WRAPPER_LOG}"
    if command -v node &>/dev/null; then
        NODE_EXEC=$(command -v node)
        echo "使用 'command -v' 找到 node: ${NODE_EXEC}" >> "${WRAPPER_LOG}"
    fi
fi

# 优先级 5: PATH 搜索
if [ -z "${NODE_EXEC}" ]; then
    echo "[优先级 5] 搜索 PATH" >> "${WRAPPER_LOG}"
    OLD_IFS=$IFS
    IFS=:
    for path_in_env in $PATH; do
        if [ -x "${path_in_env}/node" ]; then
            NODE_EXEC="${path_in_env}/node"
            echo "在 PATH 中找到 node: ${NODE_EXEC}" >> "${WRAPPER_LOG}"
            break
        fi
    done
    IFS=$OLD_IFS
fi

# 执行
if [ -z "${NODE_EXEC}" ]; then
    {
        echo "错误: 未找到 Node.js 可执行文件!"
        echo "已搜索: 安装路径、相对路径、NVM、常见路径、command -v、PATH"
    } >> "${WRAPPER_LOG}"
    exit 1
fi

{
    echo "使用 Node 可执行文件: ${NODE_EXEC}"
    echo "Node 版本: $(${NODE_EXEC} -v)"
    echo "执行: ${NODE_EXEC} ${NODE_SCRIPT}"
} >> "${WRAPPER_LOG}"

exec "${NODE_EXEC}" "${NODE_SCRIPT}" 2>> "${STDERR_LOG}"