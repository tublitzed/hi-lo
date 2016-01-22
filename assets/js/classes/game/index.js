import $ from 'jquery';
import Player from '../player';
import Deck from '../deck';
import store from '../../modules/store';
import vex from '../../plugins/vex';
import roles from '../../modules/roles';
import flash from '../../modules/flash';

const playerCount = 2;
const GUESS_HI = 'hi';
const GUESS_LO = 'lo';


/**
 * A game controls the entire app. All other objects are children of a Game.
 */
class Game {
	/**
	 * Create a new game
	 * @param  {object} opts - includes vent and optionally includes existing game info
	 */
	constructor(opts) {
		this.vent = opts.vent;
		this.pointsOnTheLine = opts.pointsOnTheLine || 0;
		this.deck = this.initDeck(opts.deck);
		this.players = this.initPlayers(opts.players);
		this.bindEventHandlers();
	}

	/**
	 * The Game object is the only place that will subscribe to and handle
	 * events triggered via the global vent object.
	 *
	 * DOM event handlers also bound here.
	 */
	bindEventHandlers() {
		this.vent.sub('save', () => this.save());
		this.vent.sub('render', () => this.render());
		this.vent.sub('drawCard', () => this.onDrawCard());
		this.vent.sub('error', (error) => this.error(error));

		var self = this;
		$('.deck__card--draw-pile').on('click', function(event) {
			event.preventDefault();
			var $this = $(this);
			//prevent rapid fire clicks from triggering multiple draws.
			if (!$this.hasClass('clicked')) {
				self.onDrawPileClick();
			}
			$this.addClass('clicked');
			setTimeout(() => {
				$this.removeClass('clicked');
			}, 1500);
		});

		$('.guess__buttons .button').on('click', function(event) {
			event.preventDefault();
			var $this = $(this);
			if ($this.hasClass('button-pass')) {
				self.pass();
			} else {
				self.submitGuess($this.hasClass('button-lower') ? GUESS_LO : GUESS_HI);
			}
		});

		$('.alert-link').on('click', function(event) {
			event.preventDefault();
			vex.dialog.alert($(this).attr('data-alert-content'));
		});
	}

	/**
	 * Submit a guess for the active player and then switch players.
	 * @param  {string} guess GUESS_LO|GUESS_HI
	 */
	submitGuess(guess) {
		console.log("TODO: guess counts are off");
		let activePlayer = this.getActivePlayer();
		activePlayer
			.setGuess(guess)
			.setGuessCount(activePlayer.guessCount > 2 ? 0 : activePlayer.guessCount + 1);
		this.switchPlayers();
	}

	/**
	 * When the currently active player chooses to pass.
	 */
	pass() {
		this.getActivePlayer().clearGuess();
		this.switchRoles();
		this.switchPlayers();
	}

	/**
	 * Handle clicks on the draw pile.
	 */
	onDrawPileClick() {
		var activePlayer = this.getActivePlayer();
		if (activePlayer.role === roles.ROLE_DEALER) {
			this.deck.draw();
		} else {
			vex.dialog.alert(activePlayer.name + ", it's not your turn to draw yet. Take a guess instead.");
		}
	}

	/**
	 * Triggered when we've drawn a new card: we're either just going to switch
	 * turns if there's no previous guess, or we need to validate prev guess
	 * against new card.
	 */
	onDrawCard() {
		let inactivePlayer = this.getInactivePlayer();
		console.log(this);
		if (this.deck.remaining === 1) {
			this.onLastCardDraw();
		} else if (inactivePlayer.guess) {
			this.checkGuess(inactivePlayer);
		} else {
			this.pointsOnTheLine += 1;
			this.switchPlayers();
		}
	}

	onLastCardDraw() {
		//TODO.
		//the game is over at this point, show some
		//indication of this.
		console.log(this);
	}

	/**
	 * Check a guess to see if it's right or wrong and then handle results.
	 * @param  {Player} inactivePlayer
	 */
	checkGuess(inactivePlayer) {
		let isHigher = this.deck.isActiveCardHigherThanPrev();
		let isCorrect = isHigher ? inactivePlayer.guess === GUESS_HI : inactivePlayer.guess === GUESS_LO;
		if (isCorrect) {
			this.onCorrectGuess();
		} else {
			this.onIncorrectGuess(inactivePlayer);
		}
	}

	/**
	 * Handle a correct guess.
	 */
	onCorrectGuess() {
		this.renderDeck();
		this.showGuessResult(true);

		setTimeout(() => {
			this.pointsOnTheLine += 1;
			this.switchPlayers();
		}, flash.DISPLAY_DURATION + 100);
	}

	/**
	 * Handle an incorrect guess.
	 * Update the inactivePlayer(the Guesser) score, show the results of the guess 
	 * onscreen for a moment, and then clear results and move forward.
	 * 
	 * @param  {Player} inactivePlayer
	 */
	onIncorrectGuess(inactivePlayer) {
		this.render();
		this.showGuessResult(false);
		inactivePlayer
			.incrementScore(this.pointsOnTheLine)
			.clearGuess()
			.render();

		setTimeout(() => {
			this.clearDiscardPile();
		}, flash.DISPLAY_DURATION);
	}

	/**
	 * When a guess is incorrect, we clear the pile.
	 */
	clearDiscardPile() {
		this.pointsOnTheLine = 0;
		this.deck.clearActiveCard();
		this.render();
	}

	/**
	 * Flash a quick message on screen to show guess result.
	 * @param  {Boolean} isCorrect
	 */
	showGuessResult(isCorrect) {
		let message = isCorrect ? 'Correct!' : 'Wrong!';
		let type = isCorrect ? flash.TYPE_SUCCESS : flash.TYPE_ERROR;
		flash.show(message, type);
	}

	/**
	 * Save current game state. Uses localStorage.
	 */
	save() {
		store.saveGame(JSON.stringify(this));
	}

	/**
	 * Create a new deck object.
	 * @param  {object|null}
	 * @return {Deck}
	 */
	initDeck(existingDeck) {
		return new Deck({
			vent: this.vent,
			deck: existingDeck
		});
	}

	/**
	 * Build player objects either from scratch or using
	 * existing player data from a previous game.
	 * 
	 * @param  {array|null} existingPlayers - if set, build players using this.
	 * @return {array}
	 */
	initPlayers(existingPlayers) {
		let players = [];
		if (existingPlayers) {
			existingPlayers.forEach((playerData) => {
				Object.assign(playerData, {
					vent: this.vent
				});
				players.push(this.createPlayer(playerData));
			});
		} else {
			var i;
			for (i = 1; i <= playerCount; i++) {
				players.push(this.createPlayer({
					vent: this.vent,
					id: 'player' + i,
					name: 'Player ' + i,
					role: i === 1 ? roles.ROLE_DEALER : roles.ROLE_GUESSER,
					active: i === 1
				}));
			}
		}
		return players;
	}

	/**
	 * Create a new player and render.
	 * @param {object} opts
	 */
	createPlayer(opts) {
		let player = new Player(opts);
		player.render();
		return player;
	}

	/**
	 * Get active player
	 
	 * @return {Player|undefined}
	 */
	getActivePlayer() {
		return this.players.find((player) => {
			if (player.active) {
				return player;
			}
		});
	}

	/**
	 * Get inactive player
	 
	 * @return {Player|undefined}
	 */
	getInactivePlayer() {
		return this.players.find((player) => {
			if (!player.active) {
				return player;
			}
		});
	}

	/**
	 * Change the active player. This assumes that we have
	 * 2 players in a game.
	 * 
	 * We'll always save game state each time this happens.
	 */
	switchPlayers() {
		this.players.forEach((player) => player.toggle());
		this.render();
		this.save();
	}

	/**
	 * Switch roles: dealer becomes player, and vice versa.
	 */
	switchRoles() {
		this.players.forEach((player) => player.switchRole().render());
	}

	/**
	 * Enable/disable the pass btn
	 * @param  {Boolean} disable
	 */
	togglePassPrivileges(disable) {
		$('.button-pass').attr('disabled', disable);
		$('.pass-label').toggleClass('pass-label--disabled', disable);
	}

	/**
	 * Fills in UI based on state of the game.
	 */
	render() {
		var activePlayer = this.getActivePlayer();
		this.renderHeadline(activePlayer);
		this.renderGuess(activePlayer);
		this.renderDeck();
	}

	/**
	 * Toggles visibility and updates relevant details for guess ui: hi/lo btns, pass, 
	 * info text, etc.
	 * 
	 * @param  {Player} activePlayer
	 */
	renderGuess(activePlayer) {
		var $guess = $('.guess');
		$guess.find('.guess__info').hide();
		$guess.find('.active-card-value').html(this.deck.activeCard ? this.deck.activeCard.value.toLowerCase() : '');
		$guess.find('.active-card-suit').html(this.deck.activeCard ? this.deck.activeCard.suit.toLowerCase() : '');


		//there are 3 possible cases here that require 3 different UIs.
		// a - guesser. b - dealer, no guess has been made. c - dealer - with active guess.
		if (activePlayer.role === roles.ROLE_GUESSER) {
			this.togglePassPrivileges(activePlayer.guessCount < 3);
			$guess.find('.guess__info--guesser').show();
		} else if (this.deck.activeCard) {
			let inactivePlayer = this.getInactivePlayer();
			$guess.find('.guesser-name').html(inactivePlayer.name);
			$guess.find('.guess-value').html(inactivePlayer.guess === GUESS_LO ? 'lower' : 'higher');
			$guess.find('.guess__info--dealer').show();
		}
	}

	/**
	 * Triggered on initial render and when values change: update
	 * the headline showing active player and instructions.
	 *
	 * @param {Player} activePlayer
	 */
	renderHeadline(activePlayer) {
		var $headline = $('.headline');
		$headline.find('.headline__player').html(activePlayer.getHeadlineHtml());
		$headline.find('.headline__instruction').html(activePlayer.getSecondaryHeadlineHtml());
	}

	/**
	 * Updates deck area of the UI.
	 */
	renderDeck() {
		this.renderPointsOtl();
		this.renderCardsLeft();
		this.renderDiscardPile();
	}

	/**
	 * Render the number of cards left.
	 */
	renderCardsLeft() {
		let cardsLeft = this.deck.remaining || 52; //we don't always have a deck here...(so really, shoud move this.)
		cardsLeft += (cardsLeft === 1) ? ' card left' : ' cards left';
		$('.cards-left').html(cardsLeft);
	}

	renderDiscardPile() {
		//this won't always be set if nothing in discard pile.
		if (this.deck.activeCard) {
			let card = this.deck.activeCard;
			let $cardImg = $('<img>').prop('src', card.images.png).prop('alt', card.value + ' ' + card.suit.toLowerCase());
			$cardImg.addClass('deck__card-img')
			$('.deck__card--discard-pile').html($cardImg).addClass('deck__card--discard-pile--has-card');
		} else {
			$('.deck__card--discard-pile').html('').removeClass('deck__card--discard-pile--has-card');
		}
	}

	/**
	 * Render details about points on the line.
	 */
	renderPointsOtl() {
		var $pointsOnTheLineWrapper = $('.points-otl');
		$pointsOnTheLineWrapper.find('.points-otl__point-value').html(this.pointsOnTheLine);
		$pointsOnTheLineWrapper.find('.points-otl__text').text(this.pointsOnTheLine === 1 ? 'point' : 'points');
	}

	/**
	 * Handle errors that will break the UI by offering to reset the game.
	 *
	 * API stores deck for 2 weeks. Theoretically a person
	 * could have a game saved in localStorage longer than that, we'd fail
	 * when attempting to reload it, for example.
	 *
	 * This is a catch-all for misc API errors/etc.
	 *
	 * @param {string=} messageDetails - if set, use this.
	 * 
	 */
	error(messageDetails) {
		let errorMessage = 'Uh oh! There was a problem with your game. Start a new game?';
		if (messageDetails) {
			errorMessage = messageDetails + ' Start a new game?';
		}
		vex.dialog.confirm({
			message: errorMessage,
			callback: function(value) {
				if (value) {
					store.clearGame();
					window.location.reload();
				}
			}
		});
	}
};
module.exports = Game;