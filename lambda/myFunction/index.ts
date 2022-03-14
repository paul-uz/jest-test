import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, GetCommandInput, UpdateCommand, UpdateCommandInput } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent } from 'aws-lambda';
import fs from 'fs';
import path from 'path';
import Stripe from 'stripe';

const ENV_VARS = {
  REGION: process.env.REGION ?? 'eu-west-1',
  STRIPE_API_VERSION: '2020-08-27' as Stripe.LatestApiVersion,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  USER_ENTITLEMENTS_TABLE: process.env.USER_ENTITLEMENTS_TABLE ?? 'GC-Streaming-User-Entitlements',
};

class Handler {
  client: DynamoDBClient = new DynamoDBClient({region: ENV_VARS.REGION});
  ddbDocClient: DynamoDBDocumentClient;
  stripe: Stripe;

  constructor() {
    this.ddbDocClient = DynamoDBDocumentClient.from(this.client, {marshallOptions: {removeUndefinedValues: true}});
    this.stripe = new Stripe(
      ENV_VARS.STRIPE_SECRET_KEY,
      {
        apiVersion: ENV_VARS.STRIPE_API_VERSION,
      },
    );
  }

  public main = async (event: APIGatewayProxyEvent) => {
    try {
      if (!this.isIpAllowed(event.requestContext.identity.sourceIp)) {
        throw new Error('IP not allowed');
      }

      try {
        const stripeSignature = event.headers['Stripe-Signature'];

        if (!stripeSignature) {
          throw new Error('Stripe signature missing');
        }

        const stripeEvent: Stripe.Event = this.stripe.webhooks.constructEvent(event.body!, stripeSignature, ENV_VARS.STRIPE_WEBHOOK_SECRET);
        const subscription: Stripe.Subscription = stripeEvent.data.object as Stripe.Subscription;
        const stripeCustomerID: string = subscription.customer as string;
        const userID = subscription.metadata.userID;
        const subscriptionItem = subscription.items.data[0] as Stripe.SubscriptionItem;
        const priceEntitlements: string[] = subscriptionItem.price.metadata.entitlements.split(',');

        switch (stripeEvent.type) {
          case 'customer.subscription.created': {
            const userEntitlements: string[] = await this.getUserEntitlements(userID);
            for (const entitlement of priceEntitlements) {
              if (userEntitlements && !userEntitlements.includes(entitlement)) {
                userEntitlements.push(entitlement);
              }
            }
            await this.setUserEntitlements(userID, userEntitlements, stripeCustomerID);
            break;
          }
          case 'customer.subscription.deleted': {
            const userEntitlements: string[] = await this.getUserEntitlements(userID);
            const newEntitlements = userEntitlements.filter((entitlement) => !priceEntitlements.includes(entitlement));
            await this.setUserEntitlements(userID, newEntitlements);
            break;
          }
        }
      } catch (error: any) {
        console.error(error);
      }

    } catch (error: any) {
      console.error(error);
    }

    return {
      statusCode: 200,
      headers: null,
      body: null,
    };
  };

  public isIpAllowed = (ip: string): boolean => {
    const ipJsonPath = path.resolve(__dirname, './ips_webhooks.json');
    const ips = fs.readFileSync(ipJsonPath, 'utf8');
    const ipsList = JSON.parse(ips);
    return ipsList['WEBHOOKS'].includes(ip);
  };

  private getUserEntitlements = async (userID: string): Promise<string[]> => {
    const params: GetCommandInput = {
      TableName: ENV_VARS.USER_ENTITLEMENTS_TABLE,
      Key: {
        userID,
      },
    };
    const result = await this.ddbDocClient.send(new GetCommand(params));
    return result.Item?.entitlements ?? [];
  };

  private setUserEntitlements = async (userID: string, priceEntitlements: string[], stripeCustomerID?: string) => {
    const params: UpdateCommandInput = {
      TableName: ENV_VARS.USER_ENTITLEMENTS_TABLE,
      Key: {
        userID: userID,
      },
      UpdateExpression: 'set #entitlements = :entitlements',
      ExpressionAttributeNames: {
        '#entitlements': 'entitlements',
      },
      ExpressionAttributeValues: {
        ':entitlements': priceEntitlements,
      },
    };

    if (stripeCustomerID) {
      params.UpdateExpression += ', #stripeCustomerID = :stripeCustomerID';
      params.ExpressionAttributeNames!['#stripeCustomerID'] = 'stripeCustomerID';
      params.ExpressionAttributeValues![':stripeCustomerID'] = stripeCustomerID;
    }

    return this.ddbDocClient.send(new UpdateCommand(params));
  };
}

export const handler: Handler = new Handler();
export const main = handler.main.bind(handler);
