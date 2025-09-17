/* eslint-disable */
// js/相似度工作线程.js
importScripts('../libs/ort.min.js'); // 调整路径以匹配您的文件结构

// 全局Worker状态
let session = null;
let modelPathInternal = null;
let ortEnvConfigured = false;
let sessionOptions = null;
let modelInputNames = null; // 存储模型的输入名称

// 复用的 TypedArray 缓冲区，减少内存分配
let reusableBuffers = {
  inputIds: null,
  attentionMask: null,
  tokenTypeIds: null,
};

// 性能统计
let workerStats = {
  totalInferences: 0,
  totalInferenceTime: 0,
  averageInferenceTime: 0,
  memoryAllocations: 0,
};

// 配置 ONNX Runtime 环境 (仅一次)
function configureOrtEnv(numThreads = 1, executionProviders = ['wasm']) {
  if (ortEnvConfigured) return;
  try {
    ort.env.wasm.numThreads = numThreads;
    ort.env.wasm.simd = true; // 尽可能启用SIMD
    ort.env.wasm.proxy = false; // 在Worker中，通常不需要代理
    ort.env.logLevel = 'warning'; // 'verbose', 'info', 'warning', 'error', 'fatal'
    ortEnvConfigured = true;

    sessionOptions = {
      executionProviders: executionProviders,
      graphOptimizationLevel: 'all',
      enableCpuMemArena: true,
      enableMemPattern: true,
      // executionMode: 'sequential' // 在worker内部通常是顺序执行一个任务
    };
  } catch (error) {
    console.error('工作线程: 配置ORT环境失败', error);
    throw error; // 抛出错误，让主线程知道
  }
}

async function initializeModel(modelPathOrData, numThreads, executionProviders) {
  try {
    configureOrtEnv(numThreads, executionProviders); // 确保环境已配置

    if (!modelPathOrData) {
      throw new Error('工作线程: 未提供模型路径或数据。');
    }

    // 检查输入是否为 ArrayBuffer（缓存的模型数据）或字符串（URL 路径）
    if (modelPathOrData instanceof ArrayBuffer) {
      console.log(`工作线程: 从缓存的ArrayBuffer初始化模型 (${modelPathOrData.byteLength} 字节)`);
      session = await ort.InferenceSession.create(modelPathOrData, sessionOptions);
      modelPathInternal = '[缓存的 ArrayBuffer]'; // 用于调试目的
    } else {
      console.log(`工作线程: 从URL初始化模型: ${modelPathOrData}`);
      modelPathInternal = modelPathOrData; // 存储模型路径以备调试或重载（如果需要）
      session = await ort.InferenceSession.create(modelPathInternal, sessionOptions);
    }

    // 获取模型的输入名称，用于判断是否需要token_type_ids
    modelInputNames = session.inputNames;
    console.log(`工作线程: 模型ONNX会话创建成功: ${modelPathInternal}`);
    console.log(`工作线程: 模型输入名称:`, modelInputNames);

    return { status: 'success', message: '模型已初始化' };
  } catch (error) {
    console.error(`工作线程: 模型初始化失败:`, error);
    session = null; // 清理session以防部分初始化
    modelInputNames = null;
    // 将错误信息序列化，因为Error对象本身可能无法直接postMessage
    throw new Error(`工作线程: 模型初始化失败 - ${error.message}`);
  }
}

// 优化的缓冲区管理函数
function getOrCreateBuffer(name, requiredLength, type = BigInt64Array) {
  if (!reusableBuffers[name] || reusableBuffers[name].length < requiredLength) {
    reusableBuffers[name] = new type(requiredLength);
    workerStats.memoryAllocations++;
  }
  return reusableBuffers[name];
}

// 优化的批处理推理函数
async function runBatchInference(batchData) {
  if (!session) {
    throw new Error("工作线程: 会话未初始化。请先调用'initializeModel'。");
  }

  const startTime = performance.now();

  try {
    const feeds = {};
    const batchSize = batchData.dims.input_ids[0];
    const seqLength = batchData.dims.input_ids[1];

    // 优化：复用缓冲区，减少内存分配
    const inputIdsLength = batchData.input_ids.length;
    const attentionMaskLength = batchData.attention_mask.length;

    // 复用或创建 BigInt64Array 缓冲区
    const inputIdsBuffer = getOrCreateBuffer('inputIds', inputIdsLength);
    const attentionMaskBuffer = getOrCreateBuffer('attentionMask', attentionMaskLength);

    // 批量填充数据（避免 map 操作）
    for (let i = 0; i < inputIdsLength; i++) {
      inputIdsBuffer[i] = BigInt(batchData.input_ids[i]);
    }
    for (let i = 0; i < attentionMaskLength; i++) {
      attentionMaskBuffer[i] = BigInt(batchData.attention_mask[i]);
    }

    feeds['input_ids'] = new ort.Tensor(
      'int64',
      inputIdsBuffer.slice(0, inputIdsLength),
      batchData.dims.input_ids,
    );
    feeds['attention_mask'] = new ort.Tensor(
      'int64',
      attentionMaskBuffer.slice(0, attentionMaskLength),
      batchData.dims.attention_mask,
    );

    // 处理 token_type_ids - 只有当模型需要时才提供
    if (modelInputNames && modelInputNames.includes('token_type_ids')) {
      if (batchData.token_type_ids && batchData.dims.token_type_ids) {
        const tokenTypeIdsLength = batchData.token_type_ids.length;
        const tokenTypeIdsBuffer = getOrCreateBuffer('tokenTypeIds', tokenTypeIdsLength);

        for (let i = 0; i < tokenTypeIdsLength; i++) {
          tokenTypeIdsBuffer[i] = BigInt(batchData.token_type_ids[i]);
        }

        feeds['token_type_ids'] = new ort.Tensor(
          'int64',
          tokenTypeIdsBuffer.slice(0, tokenTypeIdsLength),
          batchData.dims.token_type_ids,
        );
      } else {
        // 创建默认的全零 token_type_ids
        const tokenTypeIdsBuffer = getOrCreateBuffer('tokenTypeIds', inputIdsLength);
        tokenTypeIdsBuffer.fill(0n, 0, inputIdsLength);

        feeds['token_type_ids'] = new ort.Tensor(
          'int64',
          tokenTypeIdsBuffer.slice(0, inputIdsLength),
          batchData.dims.input_ids,
        );
      }
    } else {
      console.log('工作线程: 跳过token_type_ids，因为模型不需要它');
    }

    // 执行批处理推理
    const results = await session.run(feeds);
    const outputTensor = results.last_hidden_state || results[Object.keys(results)[0]];

    // 使用 Transferable Objects 优化数据传输
    const outputData = new Float32Array(outputTensor.data);

    // 更新统计信息
    workerStats.totalInferences += batchSize; // 批处理计算多个推理
    const inferenceTime = performance.now() - startTime;
    workerStats.totalInferenceTime += inferenceTime;
    workerStats.averageInferenceTime = workerStats.totalInferenceTime / workerStats.totalInferences;

    return {
      status: 'success',
      output: {
        data: outputData,
        dims: outputTensor.dims,
        batchSize: batchSize,
        seqLength: seqLength,
      },
      transferList: [outputData.buffer],
      stats: {
        inferenceTime,
        totalInferences: workerStats.totalInferences,
        averageInferenceTime: workerStats.averageInferenceTime,
        memoryAllocations: workerStats.memoryAllocations,
        batchSize: batchSize,
      },
    };
  } catch (error) {
    console.error('工作线程: 批量推理失败:', error);
    throw new Error(`工作线程: 批量推理失败 - ${error.message}`);
  }
}

async function runInference(inputData) {
  if (!session) {
    throw new Error("工作线程: 会话未初始化。请先调用'initializeModel'。");
  }

  const startTime = performance.now();

  try {
    const feeds = {};

    // 优化：复用缓冲区，减少内存分配
    const inputIdsLength = inputData.input_ids.length;
    const attentionMaskLength = inputData.attention_mask.length;

    // 复用或创建 BigInt64Array 缓冲区
    const inputIdsBuffer = getOrCreateBuffer('inputIds', inputIdsLength);
    const attentionMaskBuffer = getOrCreateBuffer('attentionMask', attentionMaskLength);

    // 填充数据（避免 map 操作）
    for (let i = 0; i < inputIdsLength; i++) {
      inputIdsBuffer[i] = BigInt(inputData.input_ids[i]);
    }
    for (let i = 0; i < attentionMaskLength; i++) {
      attentionMaskBuffer[i] = BigInt(inputData.attention_mask[i]);
    }

    feeds['input_ids'] = new ort.Tensor(
      'int64',
      inputIdsBuffer.slice(0, inputIdsLength),
      inputData.dims.input_ids,
    );
    feeds['attention_mask'] = new ort.Tensor(
      'int64',
      attentionMaskBuffer.slice(0, attentionMaskLength),
      inputData.dims.attention_mask,
    );

    // 处理 token_type_ids - 只有当模型需要时才提供
    if (modelInputNames && modelInputNames.includes('token_type_ids')) {
      if (inputData.token_type_ids && inputData.dims.token_type_ids) {
        const tokenTypeIdsLength = inputData.token_type_ids.length;
        const tokenTypeIdsBuffer = getOrCreateBuffer('tokenTypeIds', tokenTypeIdsLength);

        for (let i = 0; i < tokenTypeIdsLength; i++) {
          tokenTypeIdsBuffer[i] = BigInt(inputData.token_type_ids[i]);
        }

        feeds['token_type_ids'] = new ort.Tensor(
          'int64',
          tokenTypeIdsBuffer.slice(0, tokenTypeIdsLength),
          inputData.dims.token_type_ids,
        );
      } else {
        // 创建默认的全零 token_type_ids
        const tokenTypeIdsBuffer = getOrCreateBuffer('tokenTypeIds', inputIdsLength);
        tokenTypeIdsBuffer.fill(0n, 0, inputIdsLength);

        feeds['token_type_ids'] = new ort.Tensor(
          'int64',
          tokenTypeIdsBuffer.slice(0, inputIdsLength),
          inputData.dims.input_ids,
        );
      }
    } else {
      console.log('工作线程: 跳过token_type_ids，因为模型不需要它');
    }

    const results = await session.run(feeds);
    const outputTensor = results.last_hidden_state || results[Object.keys(results)[0]];

    // 使用 Transferable Objects 优化数据传输
    const outputData = new Float32Array(outputTensor.data);

    // 更新统计信息
    workerStats.totalInferences++;
    const inferenceTime = performance.now() - startTime;
    workerStats.totalInferenceTime += inferenceTime;
    workerStats.averageInferenceTime = workerStats.totalInferenceTime / workerStats.totalInferences;

    return {
      status: 'success',
      output: {
        data: outputData, // 直接返回 Float32Array
        dims: outputTensor.dims,
      },
      transferList: [outputData.buffer], // 标记为可转移对象
      stats: {
        inferenceTime,
        totalInferences: workerStats.totalInferences,
        averageInferenceTime: workerStats.averageInferenceTime,
        memoryAllocations: workerStats.memoryAllocations,
      },
    };
  } catch (error) {
    console.error('工作线程: 推理失败:', error);
    throw new Error(`工作线程: 推理失败 - ${error.message}`);
  }
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data;

  try {
    switch (type) {
      case 'init':
        // 支持 modelPath（URL 字符串）和 modelData（ArrayBuffer）
        const modelInput = payload.modelData || payload.modelPath;
        await initializeModel(modelInput, payload.numThreads, payload.executionProviders);
        self.postMessage({ id, type: 'init_complete', status: 'success' });
        break;
      case 'infer':
        const result = await runInference(payload);
        // 使用 Transferable Objects 优化数据传输
        self.postMessage(
          {
            id,
            type: 'infer_complete',
            status: 'success',
            payload: result.output,
            stats: result.stats,
          },
          result.transferList || [],
        );
        break;
      case 'batchInfer':
        const batchResult = await runBatchInference(payload);
        // 使用 Transferable Objects 优化数据传输
        self.postMessage(
          {
            id,
            type: 'batchInfer_complete',
            status: 'success',
            payload: batchResult.output,
            stats: batchResult.stats,
          },
          batchResult.transferList || [],
        );
        break;
      case 'getStats':
        self.postMessage({
          id,
          type: 'stats_complete',
          status: 'success',
          payload: workerStats,
        });
        break;
      case 'clearBuffers':
        // 清理缓冲区，释放内存
        reusableBuffers = {
          inputIds: null,
          attentionMask: null,
          tokenTypeIds: null,
        };
        workerStats.memoryAllocations = 0;
        self.postMessage({
          id,
          type: 'clear_complete',
          status: 'success',
          payload: { message: '缓冲区已清理' },
        });
        break;
      default:
        console.warn(`工作线程: 未知的消息类型: ${type}`);
        self.postMessage({
          id,
          type: 'error',
          status: 'error',
          payload: { message: `未知的消息类型: ${type}` },
        });
    }
  } catch (error) {
    // 确保将错误作为普通对象发送，因为Error对象本身可能无法正确序列化
    self.postMessage({
      id,
      type: `${type}_error`, // 如 'init_error' 或 'infer_error'
      status: 'error',
      payload: {
        message: error.message,
        stack: error.stack, // 可选，用于调试
        name: error.name,
      },
    });
  }
};
