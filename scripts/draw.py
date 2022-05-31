# -*- coding: utf-8 -*-

import matplotlib.pyplot as plt
import json

if __name__=='__main__':
    x = [1, 2, 3]
    y = [1, 4, 9]
    f = open('./price.json')
    data = list(json.load(f))
    ys = map(lambda item: item['price'], data)
    xs = map(lambda item: item['blockNumber'], data)
    plt.plot(xs, ys)
    plt.title('price of WETH/USDC in 24h')
    plt.xlabel('blockNumber')
    plt.ylabel('weth/usdc price')
    plt.show()
