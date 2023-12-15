import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import { algos } from '@algorandfoundation/algokit-utils';
import { encodeUint64, makePaymentTxnWithSuggestedParamsFromObject } from 'algosdk';
import { RaffleClient } from '../contracts/clients/RaffleClient';

// I can't get a copy of the randomness beacon running locally, this is just placeholder
const BEACON_APP_ID = 1002;

const fixture = algorandFixture();

let appClient: RaffleClient;
let testAppId: bigint | number;
let testAppAddress: string;

describe('Raffle', () => {
  beforeEach(fixture.beforeEach);

  beforeAll(async () => {
    await fixture.beforeEach();
    const { algod, testAccount } = fixture.context;

    appClient = new RaffleClient(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: 0,
      },
      algod
    );

    await appClient.create.createApplication({ beaconApp: BEACON_APP_ID, price: algos(1).algos, length: 20 });
    const { appId, appAddress } = await appClient.appClient.getAppReference();

    testAppId = appId;
    testAppAddress = appAddress;

    await appClient.appClient.fundAppAccount(algos(5));
  });

  test('optInApplication', async () => {
    const { algod, testAccount } = fixture.context;

    const userAppClient = new RaffleClient(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: testAppId,
      },
      algod
    );

    await userAppClient.optIn.optInToApplication({});

    const r = await userAppClient.getLocalState(testAccount.addr);

    // local state is set to 0 on optin
    expect(r.numTicketsBought?.asNumber()).toEqual(0);
  });

  test('buyTicket', async () => {
    const { algod, testAccount } = fixture.context;

    const userAppClient = new RaffleClient(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: testAppId,
      },
      algod
    );

    await userAppClient.optIn.optInToApplication({});

    const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
      from: testAccount.addr,
      to: testAppAddress,
      amount: algos(1).microAlgos,
      suggestedParams: await algod.getTransactionParams().do(),
    });

    const numTicketsBought = await userAppClient.buyTicket(
      { payTxn },
      {
        boxes: [{ appIndex: 0, name: encodeUint64(0) }],
      }
    );

    // will return zero if first, as its the index for the ticket
    expect(Number(numTicketsBought.return)).toEqual(0);
  });

  test('manyEntries', async () => {
    const { algod, generateAccount } = fixture.context;

    for (let i = 1; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const acc = await generateAccount({ initialFunds: algos(10) });

      const rc = new RaffleClient(
        {
          sender: acc,
          resolveBy: 'id',
          id: testAppId,
        },
        algod
      );

      // eslint-disable-next-line no-await-in-loop
      await rc.optIn.optInToApplication({});

      const txn = makePaymentTxnWithSuggestedParamsFromObject({
        from: acc.addr,
        to: testAppAddress,
        amount: algos(1).microAlgos,
        // eslint-disable-next-line no-await-in-loop
        suggestedParams: await algod.getTransactionParams().do(),
      });

      // eslint-disable-next-line no-await-in-loop
      const ntb = await rc.buyTicket(
        { payTxn: txn },
        {
          boxes: [{ appIndex: 0, name: encodeUint64(i) }],
        }
      );

      console.log(ntb);
    }
  });

  test('chooseWinner', async () => {
    const { algod, testAccount } = fixture.context;

    console.log(testAppId);
    const userAppClient = new RaffleClient(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: testAppId,
      },
      algod
    );

    await algod.setBlockOffsetTimestamp(5000).do();

    await userAppClient.optIn.optInToApplication({});

    await userAppClient.chooseWinner(
      { _beaconApp: BEACON_APP_ID },
      {
        boxes: [{ appIndex: 0, name: encodeUint64(3) }],
        sendParams: {
          fee: algos(0.003),
        },
      }
    );
  });
});
