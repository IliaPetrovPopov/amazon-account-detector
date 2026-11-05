import type { MarketplaceId } from './marketplaces';

export interface CheckRequest {
  type: 'check';
  marketplace: MarketplaceId;
  force: boolean;
}

export interface ExtractEmailRequest {
  target: 'offscreen';
  html: string;
}
