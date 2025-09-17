import { stdin, stdout } from 'process';
import { Server } from './server';
import { v4 as uuidv4 } from 'uuid';
import { NativeMessageType } from 'chrome-mcp-shared';
import { TIMEOUTS } from './constant';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timeoutId: NodeJS.Timeout;
}

export class NativeMessagingHost {
  private associatedServer: Server | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();

  public setServer(serverInstance: Server): void {
    this.associatedServer = serverInstance;
  }

  // 添加消息处理器等待启动服务器
  public start(): void {
    try {
      this.setupMessageHandling();
    } catch (error: any) {
      process.exit(1);
    }
  }

  private setupMessageHandling(): void {
    let buffer = Buffer.alloc(0);
    let expectedLength = -1;

    stdin.on('readable', () => {
      let chunk;
      while ((chunk = stdin.read()) !== null) {
        buffer = Buffer.concat([buffer, chunk]);

        if (expectedLength === -1 && buffer.length >= 4) {
          expectedLength = buffer.readUInt32LE(0);
          buffer = buffer.slice(4);
        }

        if (expectedLength !== -1 && buffer.length >= expectedLength) {
          const messageBuffer = buffer.slice(0, expectedLength);
          buffer = buffer.slice(expectedLength);

          try {
            const message = JSON.parse(messageBuffer.toString());
            this.handleMessage(message);
          } catch (error: any) {
            this.sendError(`解析消息失败: ${error.message}`);
          }
          expectedLength = -1; // 重置以获取下一个数据
        }
      }
    });

    stdin.on('end', () => {
      this.cleanup();
    });

    stdin.on('error', () => {
      this.cleanup();
    });
  }

  private async handleMessage(message: any): Promise<void> {
    if (!message || typeof message !== 'object') {
      this.sendError('无效的消息格式');
      return;
    }

    if (message.responseToRequestId) {
      const requestId = message.responseToRequestId;
      const pending = this.pendingRequests.get(requestId);

      if (pending) {
        clearTimeout(pending.timeoutId);
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.payload);
        }
        this.pendingRequests.delete(requestId);
      } else {
        // 直接忽略
      }
      return;
    }

    // 处理来自 Chrome 的指令消息
    try {
      switch (message.type) {
        case NativeMessageType.START:
          await this.startServer(message.payload?.port || 3000);
          break;
        case NativeMessageType.STOP:
          await this.stopServer();
          break;
        // 保持 ping/pong 用于简单的活跃检测，但这与请求-响应模式不同
        case 'ping_from_extension':
          this.sendMessage({ type: 'pong_to_extension' });
          break;
        default:
          // 当消息类型不受支持时进行双重检查
          if (!message.responseToRequestId) {
            this.sendError(`未知的消息类型或非响应消息: ${message.type || '无类型'}`);
          }
      }
    } catch (error: any) {
      this.sendError(`处理指令消息失败: ${error.message}`);
    }
  }

  /**
   * 向 Chrome 发送请求并等待响应
   * @param messagePayload 要发送给 Chrome 的数据
   * @param timeoutMs 等待响应的超时时间（毫秒）
   * @returns Promise，成功时解析为 Chrome 返回的载荷，失败时拒绝
   */
  public sendRequestToExtensionAndWait(
    messagePayload: any,
    messageType: string = 'request_data',
    timeoutMs: number = TIMEOUTS.DEFAULT_REQUEST_TIMEOUT,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = uuidv4(); // 生成唯一请求 ID

      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId); // 超时后从 Map 中移除
        reject(new Error(`请求在 ${timeoutMs}ms 后超时`));
      }, timeoutMs);

      // 存储请求的 resolve/reject 函数和超时 ID
      this.pendingRequests.set(requestId, { resolve, reject, timeoutId });

      // 向 Chrome 发送带有 requestId 的消息
      this.sendMessage({
        type: messageType, // 定义请求类型，例如 'request_data'
        payload: messagePayload,
        requestId: requestId, // <--- 关键：包含请求 ID
      });
    });
  }

  /**
   * 启动 Fastify 服务器（现在接受 Server 实例）
   */
  private async startServer(port: number): Promise<void> {
    if (!this.associatedServer) {
      this.sendError('内部错误: 服务器实例未设置');
      return;
    }
    try {
      if (this.associatedServer.isRunning) {
        this.sendMessage({
          type: NativeMessageType.ERROR,
          payload: { message: '服务器已在运行' },
        });
        return;
      }

      await this.associatedServer.start(port, this);

      this.sendMessage({
        type: NativeMessageType.SERVER_STARTED,
        payload: { port },
      });
    } catch (error: any) {
      this.sendError(`启动服务器失败: ${error.message}`);
    }
  }

  /**
   * 停止 Fastify 服务器
   */
  private async stopServer(): Promise<void> {
    if (!this.associatedServer) {
      this.sendError('内部错误: 服务器实例未设置');
      return;
    }
    try {
      // 通过 associatedServer 检查状态
      if (!this.associatedServer.isRunning) {
        this.sendMessage({
          type: NativeMessageType.ERROR,
          payload: { message: '服务器未运行' },
        });
        return;
      }

      await this.associatedServer.stop();
      // this.serverStarted = false; // 服务器应该在成功停止后更新自己的状态

      this.sendMessage({ type: NativeMessageType.SERVER_STOPPED }); // 与之前的 'stopped' 区分
    } catch (error: any) {
      this.sendError(`停止服务器失败: ${error.message}`);
    }
  }

  /**
   * 向 Chrome 扩展发送消息
   */
  public sendMessage(message: any): void {
    try {
      const messageString = JSON.stringify(message);
      const messageBuffer = Buffer.from(messageString);
      const headerBuffer = Buffer.alloc(4);
      headerBuffer.writeUInt32LE(messageBuffer.length, 0);
      // 确保原子写入
      stdout.write(Buffer.concat([headerBuffer, messageBuffer]), (err) => {
        if (err) {
          // 考虑如何处理写入失败，可能影响请求完成
        } else {
          // 消息发送成功，无需操作
        }
      });
    } catch (error: any) {
      // 捕获 JSON.stringify 或 Buffer 操作错误
      // 如果准备阶段失败，相关请求可能永远不会被发送
      // 需要考虑是否拒绝相应的 Promise（如果在 sendRequestToExtensionAndWait 内调用）
    }
  }

  /**
   * 向 Chrome 扩展发送错误消息（主要用于发送非请求-响应类型的错误）
   */
  private sendError(errorMessage: string): void {
    this.sendMessage({
      type: NativeMessageType.ERROR_FROM_NATIVE_HOST, // 使用更明确的类型
      payload: { message: errorMessage },
    });
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    // 拒绝所有待处理的请求
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('原生主机正在关闭或 Chrome 已断开连接。'));
    });
    this.pendingRequests.clear();

    if (this.associatedServer && this.associatedServer.isRunning) {
      this.associatedServer
        .stop()
        .then(() => {
          process.exit(0);
        })
        .catch(() => {
          process.exit(1);
        });
    } else {
      process.exit(0);
    }
  }
}

const nativeMessagingHostInstance = new NativeMessagingHost();
export default nativeMessagingHostInstance;
