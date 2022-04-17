pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestErc20 is ERC20("TestErc20", "TestErc20") {
  constructor() {
    _mint(msg.sender, 10000000);
  }
}

