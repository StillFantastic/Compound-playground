const { expect } = require("chai");
const { ethers } = require("hardhat");
const BigNumber = ethers.BigNumber;

const addresses = {
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  cUSDT: "0xf650C3d88D12dB855b8bf7D11Be6C55A4e07dCC9",
  WBTC: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
  cWbTC: "0xC11b1268C1A384e55C48c2391d8d480264A3A7F4",
};

const impersonate = async (account) => {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [account],
  });

  return ethers.getSigner(account);
};

const parseWbtc = (amountStr) => {
  return ethers.utils.parseUnits(amountStr, 8);
};

const parseUsdt = (amountStr) => {
  return ethers.utils.parseUnits(amountStr, 6);
};

describe.only("FlashLoan liquidate", () => {
  let operator, borrower, liquidator;

  // ERC20
  let usdtContract;
  let wbtcContract;
  
  // Compound
  let comptrollerContract;
  let interestRateModelContract;
  let cErc20DelegateContract;
  let cWbtcContract;
  let cUsdtContract;
  let priceOracleContract;
  
  const getTestTokens = async () => {
    const Erc20Factory = await ethers.getContractFactory("TestErc20");

    usdtContract = await ethers.getContractAt("TestErc20", addresses.USDT);
    wbtcContract = await ethers.getContractAt("TestErc20", addresses.WBTC);

    // This address has a lot of wBTC and USDT
    const whale = "0xE78388b4CE79068e89Bf8aA7f218eF6b9AB0e9d0";
    const whaleSigner = await impersonate(whale);
    await usdtContract.connect(whaleSigner).transfer(operator.address, parseUsdt("10000000"));
    await wbtcContract.connect(whaleSigner).transfer(borrower.address, parseWbtc("100"));
  };

  const deployComptroller = async () => {
    const ComptrollerFactory = await ethers.getContractFactory("Comptroller");
    comptrollerContract = await ComptrollerFactory.deploy();
    await comptrollerContract.deployed();
  };
  
  const deployInterestRateModel = async () => {
    const InterestRateModelFactory = await ethers.getContractFactory("WhitePaperInterestRateModel");
    interestRateModelContract = await InterestRateModelFactory.deploy(0, 0);
    await interestRateModelContract.deployed();
  };

  const deployCErc20Delegate = async () => {
    const CErc20DelegateFactory = await ethers.getContractFactory("CErc20Delegate");
    cErc20DelegateContract = await CErc20DelegateFactory.deploy();
    await cErc20DelegateContract.deployed();
  };

  const deployCWbtc = async () => {
    const CErc20Factory = await ethers.getContractFactory("CErc20Delegator");
    cWbtcContract = await CErc20Factory.deploy(
      wbtcContract.address,
      comptrollerContract.address,
      interestRateModelContract.address,
      ethers.utils.parseUnits("1", 18 + 0), // exchange rate
      "Compound WBTC",
      "cWbTC",
      8,
      operator.address,
      cErc20DelegateContract.address,
      []
    );
    await cWbtcContract.deployed();
  };

  const deployCUsdt= async () => {
    const CErc20Factory = await ethers.getContractFactory("CErc20Delegator");
    cUsdtContract = await CErc20Factory.deploy(
      usdtContract.address,
      comptrollerContract.address,
      interestRateModelContract.address,
      ethers.utils.parseUnits("1", 18 - 2), // exchange rate
      "Compound USDT",
      "cUSDT",
      8,
      operator.address,
      cErc20DelegateContract.address,
      []
    );
    await cUsdtContract.deployed();
  };

  const deployPriceOracle = async () => {
    const PriceOracleFactory = await ethers.getContractFactory("SimplePriceOracle");
    priceOracleContract = await PriceOracleFactory.deploy();
    await priceOracleContract.deployed();
  };

  const supportMarket = async (cTokenAddress) => {
    await comptrollerContract._supportMarket(cTokenAddress);
  };

  beforeEach(async () => {
    [operator, borrower, liquidator] = await ethers.getSigners();

    await getTestTokens();

    await deployComptroller();
    await deployInterestRateModel();
    await deployPriceOracle();

    await deployCErc20Delegate();
    await deployCUsdt();
    await deployCWbtc();

    await supportMarket(cUsdtContract.address);
    await supportMarket(cWbtcContract.address);

    await comptrollerContract._setPriceOracle(priceOracleContract.address);
    await priceOracleContract.setDirectPrice(
      usdtContract.address,
      ethers.utils.parseUnits("1", 18 + 12) // USDT has 6 decimals
    );
    await priceOracleContract.setDirectPrice(
      wbtcContract.address,
      ethers.utils.parseUnits("40000", 18 + 10) // WBTC has 8 decimasl
    );

    await comptrollerContract._setLiquidationIncentive(ethers.utils.parseUnits("1.08", 18));

    await comptrollerContract._setCollateralFactor(
      cWbtcContract.address,
      ethers.utils.parseUnits("0.8", 18)
    );
    await comptrollerContract._setCollateralFactor(
      cUsdtContract.address,
      ethers.utils.parseUnits("0.7", 18)
    );

    await comptrollerContract._setCloseFactor(ethers.utils.parseUnits("0.5", 18));
  });

  it.only("should be able to liquidate", async () => {
    // Provide USDT liquidity
    await usdtContract.approve(cUsdtContract.address, ethers.utils.parseUnits("10000000", 6));
    await cUsdtContract.mint(ethers.utils.parseUnits("1000000", 6));

    // User borrow
    await wbtcContract.connect(borrower).approve(
      cWbtcContract.address,
      ethers.utils.parseUnits("2", 8)
    );
    await cWbtcContract.connect(borrower).mint(ethers.utils.parseUnits("2", 8));

    await comptrollerContract.connect(borrower).enterMarkets([cWbtcContract.address]);
    await cUsdtContract.connect(borrower).borrow(ethers.utils.parseUnits("63000", 6));

    // Modify BTC price
    await priceOracleContract.setDirectPrice(
      wbtcContract.address,
      ethers.utils.parseUnits("35000", 18 + 10)
    );

    await usdtContract.connect(liquidator)
      .approve(cUsdtContract.address, ethers.utils.parseUnits("63000", 6));

    // Liquidate
    const LiquidatorFactory = await ethers.getContractFactory("Liquidator");
    const liquidatorContract = await LiquidatorFactory.connect(liquidator)
      .deploy(cUsdtContract.address, cWbtcContract.address);
    await liquidatorContract.deployed();

    await liquidatorContract.connect(liquidator).liquidateEntry(
      borrower.address, 
      ethers.utils.parseUnits("30000", 6),
      cWbtcContract.address
    );

    // console.log(await comptrollerContract.getAccountLiquidity(borrower.address)); 
    console.log((await usdtContract.balanceOf(liquidator.address)).toNumber() / 1e6);
  });
});
