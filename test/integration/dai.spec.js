import Maker from '../../src/index';
import tokens from '../../contracts/tokens';
import { WETH } from '../../src/eth/Currency';
import debug from 'debug';
const log = debug('dai:testing');

let maker, cdp, exchange, address, tokenService;

async function convertPeth() {
  const peth = tokenService.getToken(tokens.PETH);
  const pethBalance = await peth.balanceOf(address);

  if (pethBalance.toNumber() > 0.009) {
    console.info('Remaining PETH balance is', pethBalance.toString());
    await peth.exit(pethBalance.toNumber().toFixed(2)).confirm();
    console.info('Exited remaining PETH');
  } else {
    console.info('No remaining PETH to exit');
  }
}

async function convertWeth() {
  const weth = tokenService.getToken(tokens.WETH);
  const wethBalance = await weth.balanceOf(address);

  if (wethBalance.toNumber() > 0.009) {
    console.info('Remaining WETH balance is', wethBalance.toString());
    await weth.withdraw(wethBalance.toNumber().toFixed(2)).confirm();
    console.info('Withdrew remaining WETH');
  } else {
    console.info('No remaining WETH to withdraw');
  }
}

async function checkWethBalance() {
  const weth = tokenService.getToken(tokens.WETH);
  const wethBalance = await weth.balanceOf(address);

  if (wethBalance.toNumber() < 0.01) {
    console.log(
      'Current balance is ' + wethBalance.toString() + ', depositing 0.01'
    );
    const tx = await maker.service('conversion').convertEthToWeth(0.01);
    return tx.confirm();
  } else {
    return;
  }
}

beforeAll(async () => {
  if (!process.env.PRIVATE_KEY) {
    throw new Error('Please set a private key to run integration tests.');
  }

  maker = Maker.create(process.env.NETWORK, {
    privateKey: process.env.PRIVATE_KEY,
    web3: {
      transactionSettings: {
        gasPrice: 15000000000,
        gasLimit: 4000000
      }
    }
  });

  await maker.authenticate();
  tokenService = maker.service('token');
  address = maker.service('web3').currentAccount();
  exchange = maker.service('exchange');

  maker.service('transactionManager').onNewTransaction(hybrid => {
    const {
      metadata: { contract, method } = { contract: '???', method: '???' },
      _txId
    } = hybrid;
    const label = `tx ${_txId}: ${contract}.${method}`;
    log(`${label}: new`);

    hybrid.onPending(() => log(`${label}: pending`));
    hybrid.onMined(() => log(`${label}: mined`));
    hybrid.onFinalized(() => log(`${label}: confirmed`));
  });
});

test('can create Maker instance', () => {
  expect(maker).toBeDefined();
});

test(
  'can open a CDP',
  async () => {
    cdp = await maker.openCdp().confirm();
    console.info('Opened new CDP', await cdp.getId());
    expect(cdp).toBeDefined();
  },
  300000
);

test(
  'can lock eth',
  async () => {
    const initialCollateral = await cdp.getCollateralValue();
    const tx = await cdp.lockEth(0.01);
    await tx.confirm();
    const collateral = await cdp.getCollateralValue();
    expect(collateral.toNumber()).toBeGreaterThan(initialCollateral.toNumber());
  },
  600000
);

test(
  'can withdraw Dai',
  async () => {
    const initialDebt = await cdp.getDebtValue();
    const tx = await cdp.drawDai(0.1);
    await tx.confirm();
    const currentDebt = await cdp.getDebtValue();
    expect(currentDebt.toNumber()).toBeGreaterThan(initialDebt.toNumber());
  },
  300000
);

test(
  'can sell Dai',
  async () => {
    let tx, error;

    try {
      tx = await exchange.sellDai('0.1', WETH);
    } catch (err) {
      error = err;
    }

    expect(tx).toBeDefined();
    expect(error).toBeUndefined();
  },
  600000
);

test(
  'can buy Dai',
  async () => {
    let tx, error;
    await checkWethBalance();

    try {
      tx = await exchange.buyDai('0.1', WETH);
    } catch (err) {
      error = err;
    }

    expect(tx).toBeDefined();
    expect(error).toBeUndefined();
  },
  600000
);

test(
  'can wipe debt',
  async () => {
    const initialDebt = await cdp.getDebtValue();
    const tx = await cdp.wipeDai('0.1');
    await tx.confirm();
    const currentDebt = await cdp.getDebtValue();
    expect(initialDebt.toNumber()).toBeGreaterThan(currentDebt.toNumber());
  },
  600000
);

test(
  'can shut a CDP',
  async () => {
    await cdp.shut();
    await convertPeth();
    await convertWeth();
    const info = await cdp.getInfo();
    expect(info.lad).toBe('0x0000000000000000000000000000000000000000');
  },
  1200000
);