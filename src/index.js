/*
* @Author: mike
* @Date:   2016-04-10 11:33:11
* @Last Modified 2016-04-10
* @Last Modified time: 2016-04-10 20:18:29
*/

'use strict';

import Subscription from './models/subscription.js'
import Plan from './models/plan.js'

import stripe from 'stripe'

export default class Stripe {
  constructor(app) {
    this.app = app;
    this.opts = this.app.config.stripe
    
    let defaultConfig = {
      privateKey: "",
      publicKey: "",
      template: "page"
    }
    
    app.writeDefaultConfig('stripe', defaultConfig)

    this._setupModels()
    this._setupMiddleware()
    this._setupRoutes()
    this._setupTemplates()
    this._setupStripe()

    app.get('stripe').use(this)
    .respond('subscribe')
    .respond('updateSubscription')
    .respond('cancelSubscription')
  }

  _setupTemplates() {
    this.app.get('templater').templateDir('ejs', __dirname+"/../views")
  }

  _setupStripe() {
    this.stripe = stripe(this.opts.privateKey)
  }

  _setupModels() {
    this.app.get('storage').model(Subscription)
    this.app.get('storage').model(Plan)
    this.app.get('admin-ui').adminModel('plan')
    this.app.get('storage').on('model.create.user', (identity, record) => {
      this.app.get('storage').getModel('subscription').then((Subscription) => {
        return Subscription.create({user: record})
      })
    })
  }

  _setupMiddleware() {
    this.app.get('router').middleware((req, res, next) => {
      if(!req.user || req.subscription) return next()
      return this.app.get('storage').getModel('subscription').then((Subscription) => {
        return Subscription.findOne().where({user: req.user.id}).then((subscription) => {
          if(subscription) req.subscription = subscription
          next()
        })
      })
    })
  }

  _setupRoutes() {
    let router = this.app.get('router')
    router.route("post", "/payment/process/:id", this._process.bind(this))
    router.route("/payment/:id", this._payment.bind(this))
    router.route("/profile/subscription", this._subscription.bind(this))
    router.route("/profile/subscription/change", this._subscriptionChange.bind(this))
    router.route("post", "/profile/subscription/save", this._subscriptionSave.bind(this))
    router.route("/profile/subscription/cancel", this._subscriptionCancel.bind(this))
    router.route("post", "/profile/subscription/cancel", this._subscriptionCancelSave.bind(this))
    router.route("post", "/profile/billing/update/:id", this._billingUpdate.bind(this))
    router.route("/profile/billing", this._billing.bind(this))
  }

  _billing(req, res) {
    return this.app.get('templater').renderPartial('stripe-billing', this.opts.template, {title: 'Billing', req, stripe: this.opts}).then(res.send.bind(res))
  }

  _billingUpdate(req, res) {
    console.log('billing update')
    let stripeToken = req.body.stripeToken
    let plan = req.body.plan
    let id = req.param('id')
    var user = null
    var models = {}
    return this.app.get('storage').getModel(['user', 'subscription']).spread((User, Subscription) => {
      models.User = User
      models.Subscription = Subscription
      return User.findOne(id)
    }).then((u) => {
      console.log('u', u)
      if(!u) return res.status(404).send()
      user = u
      return this.stripe.customers.update(req.subscription.customer.id, {
        source: stripeToken
      }).then((customer) => {
        let subscription = {customer}
        return models.Subscription.update({user: user.id}, subscription)
      });
    }).then(() => {
      return req.login(user, () => {
        req.flash('info', 'Billing method updated successfully.')
        res.redirect('/profile/billing')
      })
    })
  }

  _subscriptionChange(req, res) {
    return this.app.get('storage').getModel('plan').then((Plan) => {
      return Plan.find().where()
    }).then((plans) => {
      return this.app.get('templater').renderPartial('stripe-subscription-change', this.opts.template, {plans, title: 'Change Subscription', req})
    }).then(res.send.bind(res))
  }

  _subscriptionSave(req, res) {
    let stripeToken = req.body.stripeToken
    let plan = req.body.plan
    console.log('subscription change', plan)
    let id = req.user.id
    var user = null
    var models = {}
    return this.app.get('storage').getModel(['user', 'subscription']).spread((User, Subscription) => {
      models.User = User
      models.Subscription = Subscription
      return User.findOne(id)
    }).then((u) => {
      console.log('u', u)
      if(!u) return res.status(404).send()
      user = u
      return this.stripe.customers.updateSubscription(req.subscription.customer.id, req.subscription.customer.subscriptions.data[0].id, {
        plan: plan
      }).then((sub) => {
        let subscription = req.subscription
        subscription.customer.subscriptions.data[0] = sub
        return models.Subscription.update({user: user.id}, subscription)
      });
    }).then(() => {
      return req.login(user, () => {
        req.subscription = null
        req.flash('info', 'Plan changed successfully.')
        res.redirect('/profile/subscription')
      })
    })
  }

  _subscriptionCancelSave(req, res) {
    console.log('subscription change')
    let stripeToken = req.body.stripeToken
    let plan = req.body.plan
    let id = req.user.id
    var user = null
    var models = {}
    return this.app.get('storage').getModel(['user', 'subscription']).spread((User, Subscription) => {
      models.User = User
      models.Subscription = Subscription
      return User.findOne(id)
    }).then((u) => {
      console.log('u', u)
      if(!u) return res.status(404).send()
      user = u
      return this.stripe.customers.cancelSubscription(req.subscription.customer.id, req.subscription.customer.subscriptions.data[0].id).then((sub) => {
        let subscription = req.subscription
        subscription.customer.subscriptions.data[0] = sub
        subscription.enabled = false
        subscription.status = 'cancelled'
        return models.Subscription.update({user: user.id}, subscription).then(() => {
          user.enabled = false
          user.verified = false
          user.save()
        })
      });
    }).then(() => {
      req.subscription = null
      req.flash('info', 'Subscription cancelled successfully.')
      res.redirect('/logout')
    })
  }

  _subscriptionCancel(req, res) {
    return this.app.get('templater').renderPartial('stripe-subscription-cancel', this.opts.template, {title: 'Cancel Subscription', req}).then(res.send.bind(res))
  }

  _subscription(req, res) {
    return this.app.get('templater').renderPartial('stripe-subscription', this.opts.template, {req, title: 'Subscription'}).then(res.send.bind(res))
  }

  _payment(req, res) {
    let id = req.param('id')
    let plan = req.param('plan')
    return this.app.get('storage').getModel('user').then((User) => {
      return User.findOne(id)
    }).then((user) => {
      if(!user) return res.status(404).send()
      let opts = {
        stripe: this.app.config.stripe,
        req, 
        user,
        plan,
        title: 'Enter Payment Information'
      }
      return this.app.get('templater').renderPartial("stripe-payment", this.opts.template, opts).then(res.send.bind(res))
    })
  }

  _process(req, res) {
    let stripeToken = req.body.stripeToken
    let plan = req.body.plan
    let id = req.param('id')
    var user = null
    var models = {}
    return this.app.get('storage').getModel(['user', 'subscription']).spread((User, Subscription) => {
      models.User = User
      models.Subscription = Subscription
      return User.findOne(id)
    }).then((u) => {
      if(!u) return res.status(404).send()
      user = u
      return this.stripe.customers.create({
        source: stripeToken,
        plan,
        email: user.email
      }).then((customer) => {
        let subscription = {enabled: true, status: 'active', customer}
        return models.Subscription.update({user: user.id}, subscription).then(() => {
          user.enabled = true
          user.verified = true
          user.save()
        })
      });
    }).then(() => {
      return req.login(user, () => {
        req.flash('info', 'Account created successfully! Welcome to GovTraq.')
        res.redirect('/profile')
      })
    })
  }

  subscribe () {

  }

  updateSubscription() {

  }

  cancelSubscription() {

  }
}