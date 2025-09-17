/**
 * SIMD优化的数学计算引擎
 * 使用WebAssembly + SIMD指令加速向量计算
 */

interface SIMDMathWasm {
  free(): void;
  cosine_similarity(vec_a: Float32Array, vec_b: Float32Array): number;
  batch_similarity(vectors: Float32Array, query: Float32Array, vector_dim: number): Float32Array;
  similarity_matrix(
    vectors_a: Float32Array,
    vectors_b: Float32Array,
    vector_dim: number,
  ): Float32Array;
}

interface WasmModule {
  SIMDMath: new () => SIMDMathWasm;
  memory: WebAssembly.Memory;
  default: (module_or_path?: any) => Promise<any>;
}

export class SIMDMathEngine {
  private wasmModule: WasmModule | null = null;
  private simdMath: SIMDMathWasm | null = null;
  private isInitialized = false;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  private alignedBufferPool: Map<number, Float32Array[]> = new Map();
  private maxPoolSize = 5;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.isInitializing && this.initPromise) return this.initPromise;

    this.isInitializing = true;
    this.initPromise = this._doInitialize().finally(() => {
      this.isInitializing = false;
    });

    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      console.log('SIMD数学引擎: 正在初始化WebAssembly模块...');

      const wasmUrl = chrome.runtime.getURL('workers/simd_math.js');
      const wasmModule = await import(wasmUrl);

      const wasmInstance = await wasmModule.default();

      this.wasmModule = {
        SIMDMath: wasmModule.SIMDMath,
        memory: wasmInstance.memory,
        default: wasmModule.default,
      };

      this.simdMath = new this.wasmModule.SIMDMath();

      this.isInitialized = true;
      console.log('SIMD数学引擎: WebAssembly模块初始化成功');
    } catch (error) {
      console.error('SIMD数学引擎: WebAssembly模块初始化失败:', error);
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * 获取对齐缓冲区（16字节对齐，适用于SIMD）
   */
  private getAlignedBuffer(size: number): Float32Array {
    if (!this.alignedBufferPool.has(size)) {
      this.alignedBufferPool.set(size, []);
    }

    const pool = this.alignedBufferPool.get(size)!;
    if (pool.length > 0) {
      return pool.pop()!;
    }

    // 创建16字节对齐缓冲区
    const buffer = new ArrayBuffer(size * 4 + 15);
    const alignedOffset = (16 - (buffer.byteLength % 16)) % 16;
    return new Float32Array(buffer, alignedOffset, size);
  }

  /**
   * 将对齐缓冲区释放回池中
   */
  private releaseAlignedBuffer(buffer: Float32Array): void {
    const size = buffer.length;
    const pool = this.alignedBufferPool.get(size);
    if (pool && pool.length < this.maxPoolSize) {
      buffer.fill(0); // 清零
      pool.push(buffer);
    }
  }

  /**
   * 检查向量是否已对齐
   */
  private isAligned(array: Float32Array): boolean {
    return array.byteOffset % 16 === 0;
  }

  /**
   * 确保向量对齐，如果未对齐则创建对齐副本
   */
  private ensureAligned(array: Float32Array): { aligned: Float32Array; needsRelease: boolean } {
    if (this.isAligned(array)) {
      return { aligned: array, needsRelease: false };
    }

    const aligned = this.getAlignedBuffer(array.length);
    aligned.set(array);
    return { aligned, needsRelease: true };
  }

  /**
   * SIMD优化的余弦相似度计算
   */
  async cosineSimilarity(vecA: Float32Array, vecB: Float32Array): Promise<number> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.simdMath) {
      throw new Error('SIMD数学引擎未初始化');
    }

    // 确保向量对齐
    const { aligned: alignedA, needsRelease: releaseA } = this.ensureAligned(vecA);
    const { aligned: alignedB, needsRelease: releaseB } = this.ensureAligned(vecB);

    try {
      const result = this.simdMath.cosine_similarity(alignedA, alignedB);
      return result;
    } finally {
      // 释放临时缓冲区
      if (releaseA) this.releaseAlignedBuffer(alignedA);
      if (releaseB) this.releaseAlignedBuffer(alignedB);
    }
  }

  /**
   * 批量相似度计算
   */
  async batchSimilarity(vectors: Float32Array[], query: Float32Array): Promise<number[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.simdMath) {
      throw new Error('SIMD数学引擎未初始化');
    }

    const vectorDim = query.length;
    const numVectors = vectors.length;

    // 将所有向量打包到连续内存布局中
    const packedVectors = this.getAlignedBuffer(numVectors * vectorDim);
    const { aligned: alignedQuery, needsRelease: releaseQuery } = this.ensureAligned(query);

    try {
      // 复制向量数据
      let offset = 0;
      for (const vector of vectors) {
        packedVectors.set(vector, offset);
        offset += vectorDim;
      }

      // 批量计算
      const results = this.simdMath.batch_similarity(packedVectors, alignedQuery, vectorDim);
      return Array.from(results);
    } finally {
      this.releaseAlignedBuffer(packedVectors);
      if (releaseQuery) this.releaseAlignedBuffer(alignedQuery);
    }
  }

  /**
   * 相似度矩阵计算
   */
  async similarityMatrix(vectorsA: Float32Array[], vectorsB: Float32Array[]): Promise<number[][]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.simdMath || vectorsA.length === 0 || vectorsB.length === 0) {
      return [];
    }

    const vectorDim = vectorsA[0].length;
    const numA = vectorsA.length;
    const numB = vectorsB.length;

    // 打包向量
    const packedA = this.getAlignedBuffer(numA * vectorDim);
    const packedB = this.getAlignedBuffer(numB * vectorDim);

    try {
      // 复制数据
      let offsetA = 0;
      for (const vector of vectorsA) {
        packedA.set(vector, offsetA);
        offsetA += vectorDim;
      }

      let offsetB = 0;
      for (const vector of vectorsB) {
        packedB.set(vector, offsetB);
        offsetB += vectorDim;
      }

      // 计算矩阵
      const flatResults = this.simdMath.similarity_matrix(packedA, packedB, vectorDim);

      // 转换为二维数组
      const matrix: number[][] = [];
      for (let i = 0; i < numA; i++) {
        const row: number[] = [];
        for (let j = 0; j < numB; j++) {
          row.push(flatResults[i * numB + j]);
        }
        matrix.push(row);
      }

      return matrix;
    } finally {
      this.releaseAlignedBuffer(packedA);
      this.releaseAlignedBuffer(packedB);
    }
  }

  /**
   * 检查SIMD支持
   */
  static async checkSIMDSupport(): Promise<boolean> {
    try {
      console.log('SIMD数学引擎: 检查SIMD支持...');

      // 获取浏览器信息
      const userAgent = navigator.userAgent;
      const browserInfo = SIMDMathEngine.getBrowserInfo();
      console.log('浏览器信息:', browserInfo);
      console.log('用户代理:', userAgent);

      // 检查WebAssembly基础支持
      if (typeof WebAssembly !== 'object') {
        console.log('不支持WebAssembly');
        return false;
      }
      console.log('✅ WebAssembly基础支持: 正常');

      // 检查WebAssembly.validate方法
      if (typeof WebAssembly.validate !== 'function') {
        console.log('❌ WebAssembly.validate不可用');
        return false;
      }
      console.log('✅ WebAssembly.validate: 正常');

      // 测试基础WebAssembly模块验证
      const basicWasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
      const basicValid = WebAssembly.validate(basicWasm);
      console.log('✅ 基础WASM验证:', basicValid);

      // 检查WebAssembly SIMD支持 - 使用正确的SIMD测试模块
      console.log('测试SIMD WASM模块...');

      // 方法1：使用标准SIMD检测字节码
      let wasmSIMDSupported = false;
      try {
        // 这是一个包含v128.const指令的最小SIMD模块
        const simdWasm = new Uint8Array([
          0x00,
          0x61,
          0x73,
          0x6d, // WASM魔数
          0x01,
          0x00,
          0x00,
          0x00, // 版本
          0x01,
          0x05,
          0x01, // 类型段
          0x60,
          0x00,
          0x01,
          0x7b, // 函数类型: () -> v128
          0x03,
          0x02,
          0x01,
          0x00, // 函数段
          0x0a,
          0x0a,
          0x01, // 代码段
          0x08,
          0x00, // 函数体
          0xfd,
          0x0c, // v128.const
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x0b, // 结束
        ]);
        wasmSIMDSupported = WebAssembly.validate(simdWasm);
        console.log('方法1 - 标准SIMD测试结果:', wasmSIMDSupported);
      } catch (error) {
        console.log('方法1失败:', error);
      }

      // 方法2：如果方法1失败，尝试更简单的SIMD指令
      if (!wasmSIMDSupported) {
        try {
          // 使用i32x4.splat指令测试
          const simpleSimdWasm = new Uint8Array([
            0x00,
            0x61,
            0x73,
            0x6d, // WASM魔数
            0x01,
            0x00,
            0x00,
            0x00, // 版本
            0x01,
            0x06,
            0x01, // 类型段
            0x60,
            0x01,
            0x7f,
            0x01,
            0x7b, // 函数类型: (i32) -> v128
            0x03,
            0x02,
            0x01,
            0x00, // 函数段
            0x0a,
            0x07,
            0x01, // 代码段
            0x05,
            0x00, // 函数体
            0x20,
            0x00, // local.get 0
            0xfd,
            0x0d, // i32x4.splat
            0x0b, // 结束
          ]);
          wasmSIMDSupported = WebAssembly.validate(simpleSimdWasm);
          console.log('方法2 - 简单SIMD测试结果:', wasmSIMDSupported);
        } catch (error) {
          console.log('方法2失败:', error);
        }
      }

      // 方法3：如果前面的方法失败，尝试检测特定的SIMD功能
      if (!wasmSIMDSupported) {
        try {
          // 检查是否支持SIMD功能标志
          const featureTest = WebAssembly.validate(
            new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
          );

          if (featureTest) {
            // 在Chrome中，如果基础WebAssembly工作且版本>=91，SIMD通常可用
            const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
            if (chromeMatch && parseInt(chromeMatch[1]) >= 91) {
              console.log('方法3 - Chrome版本检查: SIMD应该可用');
              wasmSIMDSupported = true;
            }
          }
        } catch (error) {
          console.log('方法3失败:', error);
        }
      }

      // 输出最终结果
      if (!wasmSIMDSupported) {
        console.log('❌ 不支持SIMD。浏览器要求:');
        console.log('- Chrome 91+, Firefox 89+, Safari 16.4+, Edge 91+');
        console.log('您的浏览器应该支持SIMD。可能的问题:');
        console.log('1. 扩展上下文限制');
        console.log('2. 安全策略');
        console.log('3. 功能标志被禁用');
      } else {
        console.log('✅ 支持SIMD!');
      }

      return wasmSIMDSupported;
    } catch (error: any) {
      console.error('SIMD支持检查失败:', error);
      if (error instanceof Error) {
        console.error('错误详情:', {
          name: error.name,
          message: error.message,
          stack: error.stack,
        });
      }
      return false;
    }
  }

  /**
   * 获取浏览器信息
   */
  static getBrowserInfo(): { name: string; version: string; supported: boolean } {
    const userAgent = navigator.userAgent;
    let browserName = 'Unknown';
    let version = 'Unknown';
    let supported = false;

    // Chrome
    if (userAgent.includes('Chrome/')) {
      browserName = 'Chrome';
      const match = userAgent.match(/Chrome\/(\d+)/);
      if (match) {
        version = match[1];
        supported = parseInt(version) >= 91;
      }
    }
    // Firefox
    else if (userAgent.includes('Firefox/')) {
      browserName = 'Firefox';
      const match = userAgent.match(/Firefox\/(\d+)/);
      if (match) {
        version = match[1];
        supported = parseInt(version) >= 89;
      }
    }
    // Safari
    else if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) {
      browserName = 'Safari';
      const match = userAgent.match(/Version\/(\d+\.\d+)/);
      if (match) {
        version = match[1];
        const versionNum = parseFloat(version);
        supported = versionNum >= 16.4;
      }
    }
    // Edge
    else if (userAgent.includes('Edg/')) {
      browserName = 'Edge';
      const match = userAgent.match(/Edg\/(\d+)/);
      if (match) {
        version = match[1];
        supported = parseInt(version) >= 91;
      }
    }

    return { name: browserName, version, supported };
  }

  getStats() {
    return {
      isInitialized: this.isInitialized,
      isInitializing: this.isInitializing,
      bufferPoolStats: Array.from(this.alignedBufferPool.entries()).map(([size, buffers]) => ({
        size,
        pooled: buffers.length,
        maxPoolSize: this.maxPoolSize,
      })),
    };
  }

  dispose(): void {
    if (this.simdMath) {
      try {
        this.simdMath.free();
      } catch (error) {
        console.warn('释放SIMD数学实例失败:', error);
      }
      this.simdMath = null;
    }

    this.alignedBufferPool.clear();
    this.wasmModule = null;
    this.isInitialized = false;
    this.isInitializing = false;
    this.initPromise = null;
  }
}
