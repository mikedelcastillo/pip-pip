<script setup lang="ts">

</script>

<template lang="pug">
.button
    .top
        .text
            slot
    .bottom
</template>

<style scoped lang="sass">
@import "../styles/_variables.sass"

.button
    cursor: pointer
    font-size: $font-size-input
    padding-bottom: $button-total-drop
    width: fit-content
    *
        white-space: nowrap
    .top
        position: relative
        top: $button-hover-lift
        z-index: 1
        transition: top 100ms
        .text
            text-align: center
            padding: $text-padding-y $text-padding-x
    .bottom
        z-index: 0
        position: absolute
        bottom: 0
        width: 100%
        height: calc(100% - #{$button-total-drop})
    .top, .bottom
        border-radius: $border-radius
        border: $border-size solid
    
    &:hover
        .top
            top: 0
    &:active
        .top
            top: $button-total-drop
            transition: top 30ms


.button
    .top
        background-color: $color-main
        .text
            color: $color-dark-3
    .bottom
        background-color: $color-main-darker
    .top, .bottom
        border-color: $color-border

    &.accent
        .top
            background-color: $color-accent
            .text
                color: $color-dark-3
        .bottom
            background-color: $color-accent-darker
        .top, .bottom
            border-color: $color-border
            

</style>