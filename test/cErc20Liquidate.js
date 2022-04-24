const { expect } = require("chai");
const { ethers } = require("hardhat");
const BigNumber = ethers.BigNumber;


const impersonate = async (account) => {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [account],
  });

  return ethers.getSigner(account);
}

describe.only("Liquidate", () => {
  let operator;
  let comptrollerContract;
  let interestRateModelContract;
  let testErc20Contract;
  let cErc20DelegateContract;
  let cErc20Contract;
  let priceOracleContract;
  let cAaveContract;
  let aaveContract;
  let aaveWhaleSigner;

  const aaveAddress = "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9";
  const aaveWhaleAddress = "0x26a78D5b6d7a7acEEDD1e6eE3229b372A624d8b7";
  
  const deployComptroller = async () => {
    const ComptrollerFactory = await ethers.getContractFactory("Comptroller");
    comptrollerContract = await ComptrollerFactory.deploy();
    await comptrollerContract.deployed();
  };
  
  const deployInterestRateModel = async () => {
    const InterestRateModelFactory = await ethers.getContractFactory("WhitePaperInterestRateModel");
    interestRateModelContract =
      await InterestRateModelFactory.deploy(ethers.utils.parseUnits("0", 18), ethers.utils.parseUnits("0", 18));
    await interestRateModelContract.deployed();
  };

  const deployTestErc20 = async () => {
    const TestErc20Factory = await ethers.getContractFactory("TestErc20");
    testErc20Contract = await TestErc20Factory.deploy();
    await testErc20Contract.deployed();
  };

  const deployCErc20Delegate = async () => {
    const CErc20DelegateFactory = await ethers.getContractFactory("CErc20Delegate");
    cErc20DelegateContract = await CErc20DelegateFactory.deploy();
    await cErc20DelegateContract.deployed();
  };

  const deployCErc20 = async () => {
    const CErc20Factory = await ethers.getContractFactory("CErc20Delegator");
    cErc20Contract = await CErc20Factory.deploy(
      testErc20Contract.address,
      comptrollerContract.address,
      interestRateModelContract.address,
      ethers.utils.parseUnits("1", 18),
      "Compound Test ERC20",
      "cErc20",
      1,
      operator.address,
      cErc20DelegateContract.address,
      []
    );
    await cErc20Contract.deployed();
  };

  const deployCAave = async () => {
    const CErc20Factory = await ethers.getContractFactory("CErc20Delegator");
    cAaveContract = await CErc20Factory.deploy(
      aaveContract.address,
      comptrollerContract.address,
      interestRateModelContract.address,
      ethers.utils.parseUnits("1", 18),
      "Compound AAVE ERC20",
      "cAave",
      1,
      operator.address,
      cErc20DelegateContract.address,
      []
    );
    await cErc20Contract.deployed();
  };

  const deployPriceOracle = async () => {
    const PriceOracleFactory = await ethers.getContractFactory("ChainlinkPriceOracle");
    priceOracleContract = await PriceOracleFactory.deploy();
    await priceOracleContract.deployed();
  };

  const supportMarket = async (cTokenAddress) => {
    await comptrollerContract._supportMarket(cTokenAddress);
  };

  beforeEach(async () => {
    [operator] = await ethers.getSigners();
    await deployComptroller();
    await deployInterestRateModel();
    await deployTestErc20();
    await deployCErc20Delegate();
    await deployCErc20();
    await deployPriceOracle();

    aaveWhaleSigner = await impersonate(aaveWhaleAddress);
    aaveContract = await ethers.getContractAt("TestErc20", aaveAddress);
    await deployCAave();
    await operator.sendTransaction({
      to: aaveWhaleAddress,
      value: ethers.utils.parseEther("1"),
    });

    await supportMarket(cErc20Contract.address);
    await supportMarket(cAaveContract.address);

    await testErc20Contract.approve(cErc20Contract.address, ethers.utils.parseUnits("100000", 18));
    await testErc20Contract.connect(aaveWhaleSigner).approve(cErc20Contract.address, ethers.utils.parseUnits("100000", 18));

    await aaveContract.approve(cAaveContract.address, ethers.utils.parseUnits("10000", 18));
    await aaveContract.connect(aaveWhaleSigner).approve(cAaveContract.address, ethers.utils.parseUnits("10000", 18));

    await priceOracleContract.setDirectPrice(testErc20Contract.address, ethers.utils.parseUnits("100", 18));
    await comptrollerContract._setPriceOracle(priceOracleContract.address);

    await comptrollerContract._setCollateralFactor(cErc20Contract.address, ethers.utils.parseUnits("0.5", 18));
    await comptrollerContract._setCollateralFactor(cAaveContract.address, ethers.utils.parseUnits("0.5", 18));

    await comptrollerContract._setCloseFactor(ethers.utils.parseUnits("1", 18));
  });

  it("should be able to mint and redeem", async () => {
    await cErc20Contract.mint(1);

    let cBalance = await cErc20Contract.balanceOf(operator.address);
    expect(cBalance).to.be.equal(BigNumber.from("1"));

    await cErc20Contract.redeem(1);
    cBalance = await cErc20Contract.balanceOf(operator.address);
    expect(cBalance).to.be.equal(BigNumber.from("0"));
  });

  it("should be able to borrow and repay", async () => {
    await cErc20Contract.mint(10000);

    const underlyingBalanceBefore = await testErc20Contract.balanceOf(operator.address);
    await cErc20Contract.borrow(1);
    const underlyingBalanceAfter = await testErc20Contract.balanceOf(operator.address);
expect(underlyingBalanceAfter.sub(underlyingBalanceBefore)).to.be.equal("1");

    await cErc20Contract.repayBorrow(1);

    expect(await testErc20Contract.balanceOf(operator.address)).to.be.equal(underlyingBalanceBefore);
  });

  it.only("should be able to borrow test erc20 with aave as collateral", async () => {
    await cErc20Contract.mint(ethers.utils.parseUnits("10000", 18));
    // 1 AAVE roughly = 170 USD at the time of writing
    // Can borrow around $170 * 0.5 * 100(=$8500) worth of tokens
    await cAaveContract.connect(aaveWhaleSigner).mint(ethers.utils.parseUnits("100", 18));

    await comptrollerContract.connect(aaveWhaleSigner).enterMarkets([cAaveContract.address]);

    await cErc20Contract.connect(aaveWhaleSigner).borrow(ethers.utils.parseUnits("1", 18));
    console.log(await cAaveContract.balanceOf(aaveWhaleAddress));
    console.log(await testErc20Contract.balanceOf(aaveWhaleAddress));

    console.log(await comptrollerContract.getAccountLiquidity(aaveWhaleAddress)); 
    await priceOracleContract.setDirectPrice(testErc20Contract.address, ethers.utils.parseUnits("15000", 18));
    console.log(await comptrollerContract.getAccountLiquidity(aaveWhaleAddress)); 
    
    await hre.network.provider.request({
      method: "evm_setAutomine",
      params: [false],
    });
    await cAaveContract.accrueInterest();
    await hre.network.provider.request({
      method: "evm_setAutomine",
      params: [true],
    });
    await cErc20Contract.liquidateBorrow(aaveWhaleAddress, ethers.utils.parseUnits("0.1", 18), cAaveContract.address);
    console.log(await cAaveContract.balanceOf(operator.address));
    console.log(await aaveContract.balanceOf(operator.address));
  });
});
