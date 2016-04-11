/*
* @Author: mike
* @Date:   2016-04-10 16:15:26
* @Last Modified 2016-04-10
* @Last Modified time: 2016-04-10 19:42:05
*/

'use strict';


import {BaseModel} from '@nxus/storage'

export default BaseModel.extend({
  identity: 'plan',
  connection: 'default',
  attributes: {
    name: 'string',
    stripeId: 'string',
    price: 'string',
    html: 'text',
    metadata: {
      type: 'json',
      defaultsTo: {}
    },
  }
});
