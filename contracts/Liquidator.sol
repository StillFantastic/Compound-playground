pragma solidity 0.8.13;

import "hardhat/console.sol";

interface IUniswapV2Callee {
  function uniswapV2Call(address sender, uint amount0, uint amount1, bytes calldata data) external;
}

interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external;
}

interface IUniswapV2Router02 {
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable;
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external;
}

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external;
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external;
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);
}

interface ICToken is IERC20 {
  function liquidateBorrow(address borrower, uint repayAmount, address cTokenCollateral) external returns (uint);
  function redeem(uint redeemTokens) external returns (uint);
}

contract Liquidator is IUniswapV2Callee {
  address public constant WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;
  address public constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
  address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

  address public immutable owner;
  IUniswapV2Pair public usdcUsdtPair = IUniswapV2Pair(0x3041CbD36888bECc7bbCBc0045E3B1f144466f5f);
  IUniswapV2Router02 public router = IUniswapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);

  // Compound
  ICToken cUsdt;
  ICToken cWbtc;
  address borrower;
  address cTokenCollateral;
  uint256 repayAmount;

  constructor(address cUsdtAddress, address cWbtcAddress) {
    owner = msg.sender;
    cUsdt = ICToken(cUsdtAddress);
    cWbtc = ICToken(cWbtcAddress);
  }

  function liquidateEntry(
    address _borrower,
    uint256 _repayAmount,
    address _cTokenCollateral
  ) external {
    require(_cTokenCollateral == address(cWbtc), "Not supported collateral");

    borrower = _borrower;
    repayAmount = _repayAmount;
    cTokenCollateral = _cTokenCollateral;

    // Flash swap
    usdcUsdtPair.swap(0, repayAmount, address(this), "0x00");

    // Gas refund
    borrower = address(0);
    repayAmount = 0;
    cTokenCollateral = address(0);
  }

  function uniswapV2Call(
    address initiator,
    uint256 amount0Out,
    uint256 amount1Out,
    bytes calldata data
  ) external {
    require(amount0Out == 0, "amoun0 should be 0");
    require(amount1Out == repayAmount, "Wrong repay amount");

    IERC20(USDT).approve(address(cUsdt), amount1Out);
    uint256 err = cUsdt.liquidateBorrow(borrower, amount1Out, cTokenCollateral);
    require(err == 0, "Liquidate failed"); 
   
    err = cWbtc.redeem(cWbtc.balanceOf(address(this)));
    require(err == 0, "Redeem failed");

    uint256 wbtcBalance = IERC20(WBTC).balanceOf(address(this));
    console.log(wbtcBalance);
    uint256 repayFlashSwap = amount1Out * 1000 / 997 + 1;
    address[] memory path = new address[](3);
    path[0] = WBTC;
    path[1] = WETH;
    path[2] = USDT;
    IERC20(WBTC).approve(address(router), wbtcBalance);
    router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
      wbtcBalance,
      repayFlashSwap,
      path,
      address(this),
      block.timestamp
    );

    uint256 usdtBalance = IERC20(USDT).balanceOf(address(this));
    IERC20(USDT).transfer(address(usdcUsdtPair), repayFlashSwap);
    IERC20(USDT).transfer(owner, usdtBalance - repayFlashSwap);
  }
}
