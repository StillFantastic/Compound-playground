const { expect } = require("chai");
const { ethers } = require("hardhat");
const BigNumber = ethers.BigNumber;


describe("Mint and redeemt", () => {
  let operator;
  let comptrollerContract;
  let interestRateModelContract;
  let testErc20Contract;
  let cErc20DelegateContract;
  let cErc20Contract;
  let priceOracleContract;
  
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

  const deployPriceOracle = async () => {
    const PriceOracleFactory = await ethers.getContractFactory("SimplePriceOracle");
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

    await supportMarket(cErc20Contract.address);
    await testErc20Contract.approve(cErc20Contract.address, 100000000000);
    await priceOracleContract.setDirectPrice(testErc20Contract.address, ethers.utils.parseUnits("100", 18));
    await comptrollerContract._setPriceOracle(priceOracleContract.address);
    await comptrollerContract._setCollateralFactor(cErc20Contract.address, ethers.utils.parseUnits("0.5", 18));
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
});
