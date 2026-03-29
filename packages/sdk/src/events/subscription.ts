import { Connection } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { PROGRAM_ID } from '../constants';
import type { AgentProtocolEventName } from '../types/events';

export class EventSubscription {
  private subscriptionId: number | null = null;

  constructor(
    private connection: Connection,
    private eventParser: anchor.EventParser,
    private eventName: AgentProtocolEventName | '*',
    private callback: (eventName: string, data: any, slot: number) => void,
  ) {}

  start(): void {
    this.subscriptionId = this.connection.onLogs(
      PROGRAM_ID,
      (logInfo) => {
        if (logInfo.err) return;
        try {
          for (const event of this.eventParser.parseLogs(logInfo.logs)) {
            const name = event.name.charAt(0).toUpperCase() + event.name.slice(1);
            if (this.eventName === '*' || name === this.eventName) {
              this.callback(name, event.data, 0);
            }
          }
        } catch {
          // skip parse errors
        }
      },
      'confirmed',
    );
  }

  stop(): void {
    if (this.subscriptionId !== null) {
      this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
    }
  }
}
