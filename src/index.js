/*
* @Author: mike
* @Date:   2016-04-10 11:33:11
* @Last Modified 2016-04-16
* @Last Modified time: 2016-04-16 20:54:03
*/

'use strict';

import Subscription from './models/subscription.js'

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

    app.get('stripe').use(this).respond('applyCoupon')
  }

  _setupTemplates() {
    this.app.get('templater').templateDir(__dirname+"/../templates/pages", this.opts.template)
    this.app.get('templater').templateDir(__dirname+"/../templates/partials")
    this.app.get('templater').templateDir(__dirname+"/../templates/emails")
  }

  _setupStripe() {
    this.stripe = stripe(this.opts.privateKey)
  }

  _setupModels() {
    this.app.get('storage').model(Subscription)
    this.app.get('storage').on('model.create.user', (identity, record) => {
      this.app.get('storage').getModel('subscription').then((Subscription) => {
        return Subscription.create({user: record})
      })
    })
  }

  _setupMiddleware() {
    this.app.get('router').middleware((req, res, next) => {
      if(!req.user) return next()
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
    router.route("/profile/subscription/cancel", this._subscriptionCancel.bind(this))
    router.route("/profile/billing", this._billing.bind(this))
    router.route("post", "/profile/subscription/save", this._subscriptionSave.bind(this))
    router.route("post", "/profile/subscription/cancel", this._subscriptionCancelSave.bind(this))
    router.route("post", "/profile/billing/update/:id", this._billingUpdate.bind(this))

    router.route('post', '/stripe/webhook', this._processWebhook.bind(this))
  }

  applyCoupon(subscription, coupon) {
    if(!subscription || !coupon) throw new Error('Subscription or coupon not valid')
    let models = {}
    return this.app.get('storage').getModels('subscription').then((Subscription) => {
      models.Subscription = Subscription
      return this.stripe.customers.updateSubscription(subscription.customer.id, subscription.customer.subscriptions.data[0].id, {
        coupon: coupon
      })
    }).then((sub) => {
      subscription.customer.subscriptions.data[0] = sub
      return models.Subscription.update({user: subscription.user}, subscription)
    });
  }

  _processWebhook(req, res) {
    var promise
    let eventRaw = req.body
    this.app.log.debug('Strip Webhook received', eventRaw)
    if(eventRaw.livemode)
      promise = this.stripe.events.retrieve(eventRaw.id)
    else
      promise = Promise.resolve(eventRaw)
    
    promise.then((event) => {
      res.send(200)
      if(event.type == "invoice.payment_failed") this._processPaymentFailure(event.data.object.customer)
      if(event.type == "invoice.payment_succeeded") this._processPaymentSuccess(event.data.object.customer)
      if(event.type == "customer.subscription.deleted") this._processPaymentFailure(event.data.object.customer)
    })
  }

  _processPaymentFailure(customerId) {
    console.log('customerId', customerId)
    this.app.get('storage').getModel('subscription').then((Subscription) => {
      Subscription.findOne().where({'customer.id': customerId}).then((subscription) => {
        subscription.enabled = false
        subscription.status = 'failed'
        subscription.lastError = "You're account has been suspended because of payment issues. Please choose a new subscription to continue to continue using GovTraq."
        subscription.save()
      })
    })
  }

  _processPaymentSuccess(customerId) {
    console.log('customerId', customerId)
    this.app.get('storage').getModel('subscription').then((Subscription) => {
      Subscription.findOne().where({'customer.id': customerId}).then((subscription) => {
        subscription.enabled = true
        subscription.status = 'active'
        subscription.lastError = null
        subscription.save()
      })
    })
  }

  _billing(req, res) {
    return this.app.get('templater').render('stripe-billing', {title: 'Billing', req, stripe: this.opts}).then(res.send.bind(res))
  }

  _billingUpdate(req, res) {
    let source = req.body.stripeToken
    let plan = req.body.plan
    let id = req.param('id')
    let coupon = req.param('coupon')
    var user = null
    var models = {}
    return this.app.get('storage').getModel(['user', 'subscription']).spread((User, Subscription) => {
      models.User = User
      models.Subscription = Subscription
      return User.findOne(id)
    }).then((u) => {
      if(!u) return res.status(404).send()
      user = u
      let opts = {source}
      if(coupon && coupon.length != '') opts.coupon = coupon
      return this.stripe.customers.update(req.subscription.customer.id, opts).then((customer) => {
        let subscription = {customer}
        return models.Subscription.update({user: user.id}, subscription)
      });
    }).then(() => {
      return req.login(user, () => {
        req.flash('info', 'Billing method updated successfully.')
        res.redirect('/profile/billing')
      })
    }).catch((e) => {
      req.flash('error', e.message)
      res.redirect('/profile/billing')
    })
  }

  _subscriptionChange(req, res) {
    return this.stripe.plans.list().then((plans) => {
      plans = plans.data
      return this.app.get('templater').render('stripe-subscription-change', {plans, title: 'Change Subscription', req})
    }).then(res.send.bind(res))
  }

  _subscriptionSave(req, res) {
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
      if(!u) return res.status(404).send()
      user = u
      return this.stripe.customers.updateSubscription(req.subscription.customer.id, req.subscription.customer.subscriptions.data[0].id, {
        plan: plan
      }).then((sub) => {
        let subscription = req.subscription
        subscription.customer.subscriptions.data[0] = sub
        subscription.plan = plan
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
      if(!u) return res.status(404).send()
      user = u
      return this.stripe.customers.cancelSubscription(req.subscription.customer.id, req.subscription.customer.subscriptions.data[0].id).then((sub) => {
        let subscription = req.subscription
        subscription.customer.subscriptions.data[0] = sub
        subscription.enabled = false
        subscription.status = 'cancelled'
        return models.Subscription.update({user: user.id}, subscription)
      });
    }).then(() => {
      req.subscription = null
      req.flash('info', 'Subscription cancelled successfully.')
      res.redirect('/profile')
    })
  }

  _subscriptionCancel(req, res) {
    return this.app.get('templater').render('stripe-subscription-cancel', {title: 'Cancel Subscription', req}).then(res.send.bind(res))
  }

  _subscription(req, res) {
    return this.app.get('templater').render('stripe-subscription', {req, title: 'Subscription'}).then(res.send.bind(res))
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
      return this.app.get('templater').render("stripe-payment", opts).then(res.send.bind(res))
    })
  }

  _process(req, res) {
    let source = req.body.stripeToken
    let coupon = req.body.coupon
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
      let opts = {source,
        plan,
        email: user.email
      }
      if(coupon && coupon.length != '') opts.coupon = coupon
      return this.stripe.customers.create(opts).then((customer) => {
        let subscription = {enabled: true, status: 'active', customer, plan, user: user.id}
        return models.Subscription.createOrUpdate({user: user.id}, subscription).then(() => {
          return subscription
        })
      })
    }).then((subscription) => {
      var fromEmail = "noreply@" + this.app.config.host;
      var link = "http://" + this.app.config.baseUrl + "/profile";
      var siteName = this.app.config.siteName
      return this.app.get('templater').render("stripe-subscription-success", {user, subscription, link, siteName}).then((message) => {
        return this.app.get('mailer').send(user.email, fromEmail, 'Your '+siteName+' Subscription', message, {html: message})
      })
    }).then(() => {
      return req.login(user, () => {
        req.flash('info', 'Subscription purchased successfully. Your account is now active.')
        res.redirect('/profile')
      })
    }).catch((e) => {
      req.flash('error', e.message)
      res.redirect('/payment/'+id+'?plan='+plan)
    })
  }
}