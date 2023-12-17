import { Contract } from '@algorandfoundation/tealscript';

const STATUS_CREATED = 0;
const STATUS_PENDING_WINNER = 1;
const STATUS_PENDING_CLAIM = 2;
const STATUS_FINISHED = 3;

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

  status = GlobalStateKey<uint64>();

  numTicketsBought = LocalStateKey<uint64>();

  /**
   * createApplication
   *
   * @param beaconApp the round the beacon should get the data from
   * @param price the ticket price in microalgos
   * @param length the length in rounds from creation round
   *
   * @returns void
   */
  createApplication(beaconApp: Application, price: number, length: number): void {
    this.beaconApp.value = beaconApp;
    this.price.value = price;
    this.finishRound.value = globals.round + length;

    this.numTicketsSold.value = 0;

    this.status.value = STATUS_CREATED;
  }

  // override to give user a local state
  optInToApplication(): void {
    this.numTicketsBought(this.txn.sender).value = 0;
  }

  // we can upgrade the app
  updateApplication(): void {
    assert(this.txn.sender === this.app.creator);
  }

  /**
   * Buy a ticket for the raffle
   *
   * @param payTxn a pay txn with at least the ticket amount
   *
   * @returns total number of tickets sold
   */
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

  /**
   * Call the randomness beacon for data for a given round
   *
   * @param round the round the beacon should get the data from
   *
   * @returns bytes of random data
   */
  private getRandomness(round: uint64): bytes {
    const r: bytes = sendMethodCall<[uint64, bytes], bytes>({
      applicationID: this.beaconApp.value,
      name: 'must_get',
      methodArgs: [round, concat(this.txn.sender, itob(round))],
      fee: 0,
    });

    return r;
  }

  /**
   * Get a random number between min and max
   *
   * @param min smallest possible number
   * @param max largest possible number
   *
   * @returns the random number
   */
  private getRandomNumberBetween(min: uint64, max: uint64): uint64 {
    const seed = this.getRandomness(this.finishRound.value);

    return extract_uint64(seed, 0) % (max - min + 1 + min);
  }

  /**
   * Choose the winning ticket
   *
   * @param _beaconApp passed to ensure it gets include in the apps array, must match the set beaconApp value
   *
   * @returns the winning ticket (which is the name of the box where the winner is stored)
   */
  chooseWinningTicket(_beaconApp: Application): uint64 {
    // this should not exist
    assert(!this.winningTicket.exists);
    // beacon app should match the whitelisted id
    assert(_beaconApp === this.beaconApp.value);
    // must be after the finish round
    assert(globals.round > this.finishRound.value);

    const r = this.getRandomNumberBetween(0, this.numTicketsSold.value - 1);

    this.winningTicket.value = r;

    this.status.value = STATUS_PENDING_WINNER;
    return r;
  }

  /**
   * Set the winner in the global state
   *
   * @returns void
   */
  setWinner(): void {
    // this should not exist, if it has it's already been set
    assert(!this.winner.exists);

    const address = this.tickets(this.winningTicket.value).value;

    // set winner address
    this.winner.value = address;

    this.status.value = STATUS_PENDING_CLAIM;
  }

  /**
   * Claim the rewards for the winner
   *
   * @returns void
   */
  claim(): void {
    // only claimable while we're waiting
    assert(this.status.value === STATUS_PENDING_CLAIM);

    sendPayment({ amount: this.price.value * this.numTicketsSold.value, receiver: this.winner.value });

    this.status.value = STATUS_FINISHED;
  }

  /**
   * Delete a box, pay the user who created it and then delete the box
   *
   * @param boxKey the name of the box
   *
   * @returns void
   */
  reclaimBoxFee(boxKey: uint64): void {
    // only possible after raffle has finished, but winner does not need to be paid out yet
    assert(this.status.value === STATUS_PENDING_CLAIM || this.status.value === STATUS_FINISHED);

    // get who created this ticket
    const who = this.tickets(boxKey).value;

    // send them the boxfee back
    sendPayment({ amount: 100_000, receiver: who });

    this.tickets(boxKey).delete();
  }
}
