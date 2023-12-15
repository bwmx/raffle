import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import { algos, sendTransaction } from '@algorandfoundation/algokit-utils';
import {
  AtomicTransactionComposer,
  encodeAddress,
  encodeUint64,
  makeBasicAccountTransactionSigner,
  makePaymentTxnWithSuggestedParamsFromObject,
} from 'algosdk';
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

    await appClient.create.createApplication({ beaconApp: BEACON_APP_ID, price: algos(1).microAlgos, length: 30 });
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

      // it's not quite 0.2 algos, but this covers most cases
      const boxFee = algos(0.2).microAlgos;

      // TODO: needs to pay box fee storage
      const txn = makePaymentTxnWithSuggestedParamsFromObject({
        from: acc.addr,
        to: testAppAddress,
        amount: algos(1).microAlgos + boxFee,
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

  test('chooseWinningTicket', async () => {
    const { algod, testAccount } = fixture.context;

    const userAppClient = new RaffleClient(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: testAppId,
      },
      algod
    );

    // hack to advance things predictable in devnet
    for (let i = 0; i < 30; i += 1) {
      const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
        from: testAccount.addr,
        to: testAppAddress,
        amount: algos(0).microAlgos,
        // eslint-disable-next-line no-await-in-loop
        suggestedParams: await algod.getTransactionParams().do(),
      });

      // eslint-disable-next-line no-await-in-loop
      await sendTransaction({ transaction: payTxn, from: testAccount }, algod);
    }

    await userAppClient.optIn.optInToApplication({});

    // ret will be the winning ticket number
    await userAppClient.chooseWinningTicket({ _beaconApp: BEACON_APP_ID });
  });

  test('setWinner', async () => {
    const { algod, testAccount } = fixture.context;

    const userAppClient = new RaffleClient(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: testAppId,
      },
      algod
    );

    const { winningTicket } = await userAppClient.getGlobalState();

    if (!winningTicket) {
      throw Error('winningTicketNumber global set not set!');
    }

    await userAppClient.setWinner(
      {},
      {
        boxes: [{ appIndex: 0, name: encodeUint64(winningTicket?.asNumber()) }],

        sendParams: {
          fee: algos(0.002), // needs to pay fee for randomness beacon call
        },
      }
    );
  });

  test('claim', async () => {
    const { algod, testAccount } = fixture.context;

    const userAppClient = new RaffleClient(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: testAppId,
      },
      algod
    );

    const { winner } = await userAppClient.getGlobalState();

    if (!winner) {
      throw Error('winner global set not set!');
    }

    const addressString = encodeAddress(winner.asByteArray());
    console.log(addressString);

    const atc = new AtomicTransactionComposer();
    const suggestedParams = await algod.getTransactionParams().do();
    const sp = { ...suggestedParams, fee: 2_000, flatFee: true };
    const signer = makeBasicAccountTransactionSigner(testAccount);

    atc.addMethodCall({
      appID: Number(testAppId),
      method: userAppClient.appClient.getABIMethod('claim')!,
      methodArgs: [addressString],
      sender: testAccount.addr,
      signer,
      suggestedParams: sp,
      appAccounts: [addressString],
    });

    await atc.execute(algod, 4);
  });
});
