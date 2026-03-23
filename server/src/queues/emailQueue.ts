import { Queue } from 'bullmq';
import { config } from '../config';

const connection = { url: config.redis.url };

export const campaignDispatchQueue = new Queue('campaign-dispatch', {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
  },
});

export const emailSendQueue = new Queue('email-send', {
  connection,
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
  },
});

export const eventProcessingQueue = new Queue('event-processing', {
  connection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});
