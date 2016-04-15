/*
* @Author: mike
* @Date:   2016-04-10 11:33:23
* @Last Modified 2016-04-12
* @Last Modified time: 2016-04-12 14:06:31
*/

'use strict';

import {BaseModel} from '@nxus/storage'

export default BaseModel.extend({
  identity: 'subscription',
  connection: 'default',
  attributes: {
    user: {
      model: 'user'
    },
    plan: 'string',
    customer: {
      type: 'json',
      defaultsTo: {}
    },
    enabled: { 
      type: 'boolean', 
      defaultsTo: false 
    },
    status: { 
      type: 'string', 
      defaultsTo: 'pending' 
    },
    failures: { 
      type: 'integer', 
      defaultsTo: 0 
    },
    lastError: {
      type: 'json',
      defaultsTo: {}
    },
    metadata: {
      type: 'json',
      defaultsTo: {}
    },
  }
});
