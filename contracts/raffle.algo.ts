import { Contract } from '@algorandfoundation/tealscript';

const USE_DUMMY_BEACON = true;

// eslint-disable-next-line no-unused-vars
class Raffle extends Contract {
  // ticket boxmap
  // indexed by uint64, value is address who bought the ticket
  tickets = BoxMap<uint64, Address>({});

  // beacon app id, used for random number generator to get result on completion
  beaconApp = GlobalStateKey<Application>();

  // round where raffle will be over, and beacon random number will be pulled to determine result
  finishRound = GlobalStateKey<uint64>();

  price = GlobalStateKey<uint64>();

  numTicketsSold = GlobalStateKey<uint64>();

  winningTicket = GlobalStateKey<uint64>();

  winner = GlobalStateKey<Address>();

  numTicketsBought = LocalStateKey<uint64>();

  createApplication(beaconApp: Application, price: number, length: number): void {
    this.beaconApp.value = beaconApp;
    this.price.value = price;
    this.finishRound.value = globals.round + length;

    this.numTicketsSold.value = 0;
  }

  // override to give user a local state
  optInToApplication(): void {
    this.numTicketsBought(this.txn.sender).value = 0;
  }

  private getRandomness(round: uint64): bytes {
    const r: bytes = sendMethodCall<[uint64, bytes], bytes>({
      applicationID: this.beaconApp.value,
      name: 'must_get',
      methodArgs: [round, concat(this.txn.sender, itob(round))],
      fee: 0,
    });

    return r;
  }

  private getRandomNumberBetween(min: uint64, max: uint64): uint64 {
    // just return 3, makes it easier for devnet testing without a randomness beacon deployed
    if (USE_DUMMY_BEACON) {
      return 0;
    }

    const seed = this.getRandomness(this.finishRound.value);

    return <uint64>btobigint(seed) % (max - min + 1 + min);
  }

  // must reference _beaconApp
  chooseWinningTicket(_beaconApp: Application): uint64 {
    // beacon app should match the whitelisted id
    assert(_beaconApp === this.beaconApp.value);
    // must be after the finish round
    assert(globals.round > this.finishRound.value);

    const r = this.getRandomNumberBetween(0, this.numTicketsSold.value - 1);

    this.winningTicket.value = r;

    return r;
  }

  setWinner(): void {
    const address = this.tickets(this.winningTicket.value).value;

    // set winner address
    this.winner.value = address;
  }

  // send winner their payment, anyone can call. account winner has to be referenced
  // eslint-disable-next-line no-unused-vars
  claim(winner: Account): void {
    sendPayment({ amount: this.price.value * this.numTicketsSold.value, receiver: this.winner.value });
  }

  buyTicket(payTxn: PayTxn): number {
    // dont let anyone buy tickets after it ended
    assert(globals.round < this.finishRound.value);
    // must be from sender, to app address amount greater than the price of a ticket
    verifyTxn(payTxn, {
      receiver: this.app.address,
      sender: this.txn.sender,
      amount: { greaterThanEqualTo: this.price.value },
    });

    // increment tickets sold
    const numTicketsSold = this.numTicketsSold.value;

    assert(!this.tickets(numTicketsSold).exists);

    // set ticket map at index of ticket sold with buyers address
    this.tickets(numTicketsSold).value = this.txn.sender;

    // increment by one
    this.numTicketsBought(this.txn.sender).value = this.numTicketsBought(this.txn.sender).value + 1;

    // increase the indexer for the next buyer
    this.numTicketsSold.value = this.numTicketsSold.value + 1;
    // return the index of the ticket
    return numTicketsSold;
  }
}
