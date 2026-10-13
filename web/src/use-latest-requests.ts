import { useRef } from 'react';

/**
 * FR-151 ① / N11·N12：加载类请求的"最后一次发出者赢"。
 *
 * 为什么必须统一收在这里：列表、编辑器、详情三条路径都会发"可被后一次请求超越"的 GET。
 * 只要旧的那次先发后返，它就会把新结果覆盖掉（筛选被旧列表盖回去、右栏显示另一条的正文）。
 * 调用方只做两件事：发出前 `begin(channel)` 拿序号、回来后 `isLatest(channel, seq)` 复核 ——
 * 不是最新的响应直接丢弃（连带不要写状态、不要把加载态提前关掉）。
 */
export interface LatestRequests {
  /** 记下"这是第几次发往该通道的请求"并返回序号。 */
  begin: (channel: string) => number;
  /** 该序号是否仍是该通道最新的一次请求。 */
  isLatest: (channel: string, seq: number) => boolean;
}

export function useLatestRequests(): LatestRequests {
  const stateRef = useRef<{ seqs: Map<string, number>; api: LatestRequests } | null>(null);
  if (stateRef.current === null) {
    const seqs = new Map<string, number>();
    stateRef.current = {
      seqs,
      api: {
        begin: (channel: string): number => {
          const next = (seqs.get(channel) ?? 0) + 1;
          seqs.set(channel, next);
          return next;
        },
        isLatest: (channel: string, seq: number): boolean => seqs.get(channel) === seq,
      },
    };
  }
  return stateRef.current.api;
}
