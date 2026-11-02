export interface ServiceBay {
  readonly id: string;
  readonly dealershipId: string;
  readonly name: string;
  readonly active: boolean;
  readonly capabilities: readonly string[];
}
