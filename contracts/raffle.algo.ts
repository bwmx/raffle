import { Contract } from '@algorandfoundation/tealscript';

type Winner = {
  address: Address;
  ticketNumber: uint64;
  amount: uint64;
};

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

  winner = GlobalStateKey<Winner>();

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
    // const seed = this.getRandomness(this.finishRound.value);

    // wrong?
    // const r = btobigint(seed) % (max - min + 1 + min);
    if (min === max) {
      return 1;
    }
    return 3;
  }

  // must reference _beaconApp
  chooseWinner(_beaconApp: Application): Winner {
    // beacon app should match the whitelisted id
    assert(_beaconApp === this.beaconApp.value);
    // must be after the finish round
    assert(globals.round > this.finishRound.value);

    const r = this.getRandomNumberBetween(0, this.numTicketsSold.value - 1);
    const a = this.tickets(r).value;

    const winner: Winner = {
      address: a,
      ticketNumber: r,
      amount: this.price.value * this.numTicketsSold.value,
    };

    this.winner.value = winner;

    return winner;
  }

  // send winner their payment, anyone can call
  // claim(): void {
  //   // getting account not available error
  //   sendPayment({ amount: this.winner.value.amount, receiver: this.winner.value.address });
  // }

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
